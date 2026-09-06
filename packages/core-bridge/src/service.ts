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
  MihomoVersion,
  Profile,
  ProxyItem,
  ProxyMode,
  RuleInfo
} from '@teyvat-arkhon/shared'
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
}

export class CoreService extends EventEmitter {
  private readonly config: ConfigManager
  private driver: CoreDriver | null = null
  private state: CoreState = 'stopped'
  private version: MihomoVersion | undefined

  constructor(private readonly opts: CoreServiceOptions) {
    super()
    this.config = new ConfigManager({
      profilesDir: opts.profilesDir,
      activeConfigFile: opts.activeConfigFile,
      excludeKeywords: opts.excludeKeywords
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

    this.setState('starting')
    try {
      const driver = this.buildDriver(active)
      await driver.start(this.opts.activeConfigFile)
      this.driver = driver
      await this.syncVersion()
      this.setState('running')
    } catch (e) {
      this.setState('error')
      this.emit('error', e)
      throw e
    }
    return this.status()
  }

  async stop(): Promise<CoreStatus> {
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
      onExit: () => this.setState('stopped'),
      onLog: (line) => this.emit('core-log', line)
    })
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
}

function cleanController(v: string | undefined, fallback: string): string {
  if (!v) return fallback
  // 兼容 "127.0.0.1:9090" / "0.0.0.0:9090"
  const hostPort = v.includes('://') ? v.split('://')[1] : v
  return hostPort
}