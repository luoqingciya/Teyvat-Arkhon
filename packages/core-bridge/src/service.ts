/**
 * 核心服务编排层：驱动生命周期 + 配置管理 + 状态机。
 * Electron 主进程通过本服务与内核交互，不直接触达驱动细节。
 */

import { EventEmitter } from 'node:events'
import type {
  ClashConfigSummary,
  ConnectionInfo,
  CoreState,
  CoreStatus,
  DelayResult,
  DnsPresetMeta,
  DnsSettings,
  MihomoVersion,
  Profile,
  ProxyItem,
  ProxyMode,
  RuleDebugResult,
  RuleEditorState,
  RuleEntry,
  RuleInfo,
  RuleLineValidation,
  RulePresetMeta,
  RuleProvider,
  RuleProviderPreview
} from '@teyvat-arkhon/shared'
import { RULE_PRESETS } from '@teyvat-arkhon/shared'
import type { CoreDriver } from './driver'
import { ProcessCoreDriver, type ProcessDriverOptions } from './process-driver'
import { ConfigManager } from './config-manager'

export interface CoreServiceOptions {
  profilesDir: string
  activeConfigFile: string
  /** 内核驱动（当前统一使用进程驱动，稳定优先；字段保留以便未来扩展） */
  driver: { mode: 'process'; options: ProcessDriverOptions }
  fetchImpl?: typeof fetch
  /** 订阅导入/刷新的节点排除关键词（运行时读取，支持设置页动态修改） */
  excludeKeywords?: () => string[]
  /** geosite.dat / geoip.dat 候选目录（规则命中调试本地判定用） */
  geodataDirs?: string[]
}

/** 意外退出自动重启的退避间隔（第 1~5 次） */
const RESTART_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000]
const MAX_RESTART_ATTEMPTS = 5
/** 连续运行该时长后重置退避计数（短命崩溃循环保护） */
const STABLE_UPTIME_MS = 60_000
/** 假死探测间隔与判定阈值 */
const WATCHDOG_INTERVAL_MS = 30_000
const WATCHDOG_MAX_FAILS = 3

export class CoreService extends EventEmitter {
  private readonly config: ConfigManager
  private driver: CoreDriver | null = null
  private state: CoreState = 'stopped'
  private version: MihomoVersion | undefined

  // ---------- 稳定性守护 ----------
  /** 用户主动停止标记：true 时进程退出不触发自动重启 */
  private intentionalStop = false
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempts = 0
  private stableTimer: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private watchdogFails = 0

  constructor(private readonly opts: CoreServiceOptions) {
    super()
    this.config = new ConfigManager({
      profilesDir: opts.profilesDir,
      activeConfigFile: opts.activeConfigFile,
      excludeKeywords: opts.excludeKeywords,
      geodataDirs: opts.geodataDirs
    })
  }

  get activeConfigFile(): string {
    return this.opts.activeConfigFile
  }

  /** 应用启动时执行：目录初始化（随后由主进程决定是否自启） */
  async init(): Promise<void> {
    await this.config.init()
  }

  status(): CoreStatus {
    // 未启动时驱动尚未实例化，按配置的驱动模式展示（避免误显示为进程回退）
    return { state: this.state, version: this.version, driver: this.driver?.kind ?? this.opts.driver.mode }
  }

  private setState(next: CoreState): void {
    if (this.state === next) return
    this.state = next
    this.emit('state-change', this.status())
  }

  async start(): Promise<CoreStatus> {
    if (this.state === 'running') return this.status()
    const active = await this.config.getActiveSummary()
    if (!active) throw new Error('还未导入任何订阅配置，请先在"订阅"页导入')

    // 用户手动启动：取消未决的自动重启计划，重新开始
    this.clearRestartTimer()
    this.intentionalStop = false
    this.setState('starting')
    try {
      const driver = this.buildDriver(active)
      await driver.start(this.opts.activeConfigFile)
      this.driver = driver
      await this.syncVersion()
      this.setState('running')
      this.beginStableWindow()
      this.startWatchdog()
    } catch (e) {
      this.setState('error')
      this.emit('error', e)
      throw e
    }
    return this.status()
  }

  async stop(): Promise<CoreStatus> {
    this.intentionalStop = true
    this.clearRestartTimer()
    this.clearStableTimer()
    this.stopWatchdog()
    if (this.state === 'stopped' || !this.driver) {
      this.setState('stopped')
      return this.status()
    }
    this.setState('stopping')
    try {
      await this.driver.close()
      this.driver = null
      this.setState('stopped')
    } catch (e) {
      this.setState('stopped')
      this.emit('error', e)
    }
    return this.status()
  }

  /** 重载当前工作配置（档案切换等场景） */
  async reloadActive(): Promise<CoreStatus> {
    if (this.state !== 'running' || !this.driver) return this.status()
    try {
      await this.driver.reload(this.opts.activeConfigFile)
      await this.syncVersion()
    } catch (e) {
      this.emit('error', e)
      throw e
    }
    return this.status()
  }

  private buildDriver(active: ClashConfigSummary): CoreDriver {
    const opts = this.opts.driver.options
    return new ProcessCoreDriver({
      ...opts,
      externalController: cleanController(active.externalController, opts.externalController),
      secret: active.secret ?? opts.secret,
      fetchImpl: this.opts.fetchImpl,
      onExit: (code) => {
        this.stopWatchdog()
        this.clearStableTimer()
        if (this.intentionalStop || !this.driver) {
          this.setState('stopped')
          return
        }
        // 意外退出：进入自动重启退避链路
        void this.handleUnexpectedExit(code)
      },
      onLog: (line) => this.emit('core-log', line)
    })
  }

  // ---------- 稳定性守护 ----------

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  /** 连续稳定运行 60s 后重置退避计数：新崩溃重新从最短间隔开始 */
  private beginStableWindow(): void {
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      this.restartAttempts = 0
    }, STABLE_UPTIME_MS)
    this.stableTimer.unref?.()
  }

  private async handleUnexpectedExit(code: number | null): Promise<void> {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.restartAttempts = 0
      this.setState('error')
      this.emit(
        'error',
        new Error(`内核意外退出（code=${code}），自动重启 ${MAX_RESTART_ATTEMPTS} 次仍失败，已停止重试。请检查内核日志或手动启动。`)
      )
      return
    }
    const attempt = ++this.restartAttempts
    const delay = RESTART_BACKOFF_MS[Math.min(attempt - 1, RESTART_BACKOFF_MS.length - 1)]
    this.emit(
      'error',
      new Error(`内核意外退出（code=${code}），${delay / 1000}s 后自动重启（第 ${attempt}/${MAX_RESTART_ATTEMPTS} 次）`)
    )
    this.setState('starting')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.restartNow()
    }, delay)
    this.restartTimer.unref?.()
  }

  /** 按退避计划重启内核（复用当前驱动实例） */
  private async restartNow(): Promise<void> {
    if (this.intentionalStop) return
    const driver = this.driver
    if (!driver) return
    try {
      await driver.start(this.opts.activeConfigFile)
      await this.syncVersion()
      this.setState('running')
      this.beginStableWindow()
      this.startWatchdog()
    } catch (e) {
      this.emit('error', e)
      // 重启失败：继续退避（handleUnexpectedExit 会检查次数上限）
      void this.handleUnexpectedExit(null)
    }
  }

  /** 假死 watchdog：进程存活但 REST 无响应时强制重启 */
  private startWatchdog(): void {
    this.stopWatchdog()
    this.watchdogFails = 0
    this.watchdogTimer = setInterval(() => void this.watchdogTick(), WATCHDOG_INTERVAL_MS)
    this.watchdogTimer.unref?.()
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private async watchdogTick(): Promise<void> {
    if (this.state !== 'running' || !this.driver) return
    await this.registerProbe(await this.probeOnce())
  }

  /** 立即健康探测（休眠唤醒后由主进程触发）；连续失败达到阈值则强制重启 */
  async probeHealth(): Promise<boolean> {
    if (this.state !== 'running' || !this.driver) return false
    const ok = await this.probeOnce()
    await this.registerProbe(ok)
    return ok
  }

  private async probeOnce(): Promise<boolean> {
    try {
      await this.driver!.getVersion()
      return true
    } catch {
      return false
    }
  }

  private async registerProbe(ok: boolean): Promise<void> {
    if (ok) {
      this.watchdogFails = 0
      return
    }
    this.watchdogFails++
    if (this.watchdogFails < WATCHDOG_MAX_FAILS) return
    this.watchdogFails = 0
    this.emit('error', new Error('内核连续无响应（疑似假死），正在强制重启内核'))
    const driver = this.driver
    if (!driver) return
    try {
      // close() → 进程退出 → onExit（非主动停止）→ 自动重启链路
      await driver.close()
    } catch {
      /* kill 失败时由 onExit 兜底 */
    }
  }

  private async syncVersion(): Promise<void> {
    try {
      this.version = await this.driver?.getVersion()
      this.emit('version-change', this.version)
    } catch {
      this.version = undefined
    }
  }

  // ---------- 数据面 ----------

  listProxies(): Promise<ProxyItem[]> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.getProxies()
  }

  listRules(): Promise<RuleInfo[]> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.getRules()
  }

  /** 切换运行模式：内核即时生效 + 写回工作配置（内核重启后保留） */
  async setMode(mode: ProxyMode): Promise<void> {
    if (!this.driver) throw new Error('内核未运行')
    await this.driver.setMode(mode)
    await this.config.setActiveMode(mode)
  }

  async getMode(): Promise<ProxyMode | undefined> {
    if (!this.driver) return undefined
    return this.driver.getMode()
  }

  /** 最近内核日志（仅运行态；停止后保留上次缓冲快照由主进程维护） */
  getLogs(): string[] {
    return this.driver?.getLogs() ?? []
  }

  selectProxy(groupName: string, nodeName: string): Promise<void> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.selectProxy(groupName, nodeName)
  }

  testDelay(name: string, url?: string, timeoutMs?: number): Promise<DelayResult> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.testDelay(name, url, timeoutMs)
  }

  /** 全部节点最近一次延迟快照（读取内核缓存，不触发测速） */
  listDelaySnapshot(): Promise<Record<string, number | null>> {
    if (!this.driver) return Promise.resolve({})
    return this.driver.listDelaySnapshot()
  }

  getConnections(): Promise<{
    downloadTotal: number
    uploadTotal: number
    connections: ConnectionInfo[]
  }> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.getConnections()
  }

  closeConnection(id: string): Promise<void> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.closeConnection(id)
  }

  closeAllConnections(): Promise<void> {
    if (!this.driver) throw new Error('内核未运行')
    return this.driver.closeAllConnections()
  }

  /** 读取当前工作配置原文（编辑器用） */
  getActiveConfig(): Promise<string> {
    return this.config.readActiveRaw()
  }

  /** 保存并校验工作配置，内核运行中则热重载 */
  async saveActiveConfig(content: string): Promise<ClashConfigSummary> {
    const summary = await this.config.writeActiveValidated(content)
    await this.reloadActive()
    return summary
  }

  // ---------- 配置档案 ----------

  listProfiles(): Promise<Profile[]> {
    return this.config.listProfiles()
  }

  /** 导出档案为分享 URI 列表（v2rayN 风格，每行一条节点） */
  exportProfileUris(id: string): Promise<string> {
    return this.config.exportProfileUris(id)
  }

  importFromUrl(url: string): Promise<{ profile: Profile; summary: ClashConfigSummary }> {
    return this.config.importFromUrl(url, this.opts.fetchImpl)
  }

  importFromText(name: string, content: string): Promise<{ profile: Profile; summary: ClashConfigSummary }> {
    return this.config.importFromText(name, content)
  }

  removeProfile(id: string): Promise<void> {
    return this.config.removeProfile(id)
  }

  refreshProfile(id: string): Promise<Profile> {
    return this.config.refreshProfile(id, this.opts.fetchImpl)
  }

  /**
   * 刷新全部 URL 订阅（自动更新用）。
   * 失败的档案保留旧内容（refreshProfile 失败即抛错不落盘）；
   * 若当前使用中的档案被成功刷新且内核运行中，则热重载使其生效。
   */
  async refreshAllUrlProfiles(): Promise<{ ok: number; failed: number }> {
    const profiles = await this.config.listProfiles()
    const urls = profiles.filter((p) => p.url)
    let ok = 0
    let failed = 0
    const refreshedIds = new Set<string>()
    for (const p of urls) {
      try {
        await this.config.refreshProfile(p.id, this.opts.fetchImpl)
        refreshedIds.add(p.id)
        ok++
      } catch {
        failed++
      }
    }
    const active = profiles.find((p) => p.selected)
    if (ok > 0 && active && refreshedIds.has(active.id) && this.state === 'running') {
      await this.reloadActive().catch(() => undefined)
    }
    return { ok, failed }
  }

  /** 切换档案 + 热重载内核 */
  async selectProfile(id: string): Promise<ClashConfigSummary> {
    const summary = await this.config.selectProfile(id)
    await this.reloadActive()
    return summary
  }

  /** 当前生效的本地混合代理端口（供系统代理联动），无配置时返回 undefined */
  async activeHttpPort(): Promise<number | undefined> {
    const active = await this.config.getActiveSummary()
    return active?.mixedPort
  }

  /** 开关 TUN 模式：写入工作配置并热重载（内核运行中时） */
  async setTunEnabled(enabled: boolean): Promise<ClashConfigSummary> {
    const summary = await this.config.setTunEnabled(enabled)
    await this.reloadActive()
    return summary
  }

  /** 当前工作配置是否启用 TUN */
  async getTunEnabled(): Promise<boolean> {
    return (await this.config.getActiveSummary())?.tunEnabled ?? false
  }

  // ---------- 可视化分流规则编辑器 ----------

  /** 读取当前工作配置的 rules 与 rule-providers（结构化编辑状态） */
  getRuleEditorState(): Promise<RuleEditorState> {
    return this.config.readActiveRules()
  }

  /** 保存结构化 rules/rule-providers 到工作配置并热重载（内核运行中时） */
  async saveRuleEditorState(state: RuleEditorState): Promise<ClashConfigSummary> {
    const summary = await this.config.writeActiveRules(state)
    await this.reloadActive()
    return summary
  }

  /** 逐条校验规则（按当前工作配置的节点/组名做策略引用检查） */
  validateRuleLines(rules: RuleEntry[]): Promise<RuleLineValidation[]> {
    return this.config.validateRuleLines(rules)
  }

  /** 预览规则集内容（http 远程 / file 本地） */
  previewRuleProvider(provider: RuleProvider): Promise<RuleProviderPreview> {
    return this.config.previewRuleProvider(provider)
  }

  /**
   * 安装远程规则集：下载 → 落盘 providers/ → 合并写入 rule-providers（规则不变）。
   * 内核运行中时热重载使 rule-provider 立即生效。
   */
  async installRuleProvider(provider: {
    name: string
    behavior: RuleProvider['behavior']
    url: string
    interval?: number
  }): Promise<RuleEditorState> {
    const state = await this.config.installRuleProvider(provider)
    await this.reloadActive()
    return state
  }

  /** 对目标做规则命中调试（geosite/geoip/规则集本地真实判定） */
  debugRuleMatch(target: string, rules: RuleEntry[], providers?: RuleProvider[]): Promise<RuleDebugResult> {
    return this.config.debugRuleMatch(target, rules, providers)
  }

  /** 内置分流预设模板元信息列表 */
  listRulePresets(): RulePresetMeta[] {
    return RULE_PRESETS.map(({ id, name, desc }) => ({ id, name, desc }))
  }

  // ---------- DNS 分流联动 ----------

  /** 读取当前工作配置的 dns 段（结构化编辑状态） */
  getDnsState(): Promise<DnsSettings> {
    return this.config.readActiveDns()
  }

  /** 保存结构化 dns 段到工作配置并热重载（内核运行中时） */
  async saveDnsState(settings: DnsSettings): Promise<ClashConfigSummary> {
    const summary = await this.config.writeActiveDns(settings)
    await this.reloadActive()
    return summary
  }

  /** 内置 DNS 分流预设模板元信息列表 */
  listDnsPresets(): DnsPresetMeta[] {
    return this.config.listDnsPresets()
  }
}

function cleanController(v: string | undefined, fallback: string): string {
  if (!v) return fallback
  // 兼容 "127.0.0.1:9090" / "0.0.0.0:9090"
  const hostPort = v.includes('://') ? v.split('://')[1] : v
  return hostPort
}