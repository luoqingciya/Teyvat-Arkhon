/**
 * 全局状态：内核状态、订阅档案、代理节点、系统代理、页面切换、主题。
 */

import { defineStore } from 'pinia'
import type {
  CoreStatus,
  DelayResult,
  Profile,
  ProxyItem,
  ProxyMode,
  SystemProxyState,
  SystemServiceState,
  TrafficSnapshot
} from '@teyvat-arkhon/shared'
import { applyTheme, readTheme, type Theme } from '../theme'

export type ViewKey = 'home' | 'proxies' | 'profiles' | 'connections' | 'config' | 'settings' | 'logs'

interface AppState {
  status: CoreStatus
  profiles: Profile[]
  proxies: ProxyItem[]
  systemProxy: SystemProxyState
  appVersion: string
  selectedGroup: string
  activeView: ViewKey
  busy: boolean
  error: string
  /** 节点延迟结果缓存 */
  delays: Record<string, DelayResult>
  /** 实时流量快照（主进程推流） */
  traffic: TrafficSnapshot | null
  /** 最近流量历史（用于曲线） */
  trafficHistory: Array<{ t: number; down: number; up: number }>
  /** TUN 开关状态 */
  tunEnabled: boolean
  /** TUN 前置依赖（wintun 驱动是否存在） */
  tunPrereq: { wintun: boolean; windows: boolean }
  /** 系统服务状态 */
  serviceState: SystemServiceState
  /** 主题 */
  theme: Theme
  /** 数据目录信息 */
  dataInfo: { dataDir: string; portable: boolean }
  /** 当前运行模式 */
  coreMode: ProxyMode
  /** 内核日志缓冲（环形，最多 logLimit 条） */
  logs: string[]
  /** 测速配置 */
  delaySetting: { url: string; timeoutMs: number }
}

/** 测速配置本地持久化键 */
const DELAY_STORAGE_KEY = 'delay-setting'

function readDelaySetting(): { url: string; timeoutMs: number } {
  try {
    const raw = localStorage.getItem(DELAY_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { url?: string; timeoutMs?: number }
      return {
        url: typeof p.url === 'string' && p.url ? p.url : 'https://www.gstatic.com/generate_204',
        timeoutMs: typeof p.timeoutMs === 'number' && p.timeoutMs > 0 ? p.timeoutMs : 5000
      }
    }
  } catch {
    /* 忽略读取失败，用默认值 */
  }
  return { url: 'https://www.gstatic.com/generate_204', timeoutMs: 5000 }
}

/** 测速配置的最大缓冲行数（与后端 logLimit 对齐） */
const LOG_LIMIT = 500

interface BatchTestState {
  running: boolean
  current: number
  total: number
}

export const useAppStore = defineStore('app', {
  state: (): AppState & { batchTest: BatchTestState } => ({
    status: { state: 'stopped', driver: 'process' },
    profiles: [],
    proxies: [],
    systemProxy: { enabled: false },
    appVersion: '',
    selectedGroup: '',
    activeView: 'home',
    busy: false,
    error: '',
    delays: {},
    traffic: null,
    trafficHistory: [],
    tunEnabled: false,
    tunPrereq: { wintun: true, windows: false },
    serviceState: { name: 'TeyvatArkhonCore', state: 'not-installed' },
    theme: readTheme(),
    dataInfo: { dataDir: '', portable: false },
    batchTest: { running: false, current: 0, total: 0 },
    coreMode: 'rule',
    logs: [],
    delaySetting: readDelaySetting()
  }),

  getters: {
    groups(state): ProxyItem[] {
      return state.proxies.filter((p) => p.nodeType === 2)
    },
    currentGroup(state): ProxyItem | undefined {
      return state.proxies.find((p) => p.nodeType === 2 && p.name === state.selectedGroup)
    },
    running(state): boolean {
      return state.status.state === 'running'
    }
  },

  actions: {
    /** 应用启动：订阅主进程事件并拉取全量状态 */
    async init(): Promise<void> {
      window.arkhon.onStateChange((status) => {
        this.status = status
      })
      window.arkhon.onTraffic((snapshot) => {
        this.traffic = snapshot
        this.trafficHistory.push({ t: Date.now(), down: snapshot.downloadSpeed, up: snapshot.uploadSpeed })
        if (this.trafficHistory.length > 60) this.trafficHistory.shift()
      })
      window.arkhon.onError((message) => {
        this.error = message
        setTimeout(() => (this.error = ''), 6000)
      })
      window.arkhon.onCoreLog((line) => {
        this.logs.push(line)
        if (this.logs.length > LOG_LIMIT) this.logs.shift()
      })
      await this.refreshStatus()
      await this.refreshProfiles()
      await this.refreshSystemProxy()
      await this.refreshTun()
      await this.refreshService()
      await this.refreshTunPrereq()
      await this.initCoreMode()
      await this.initLogs()
      this.appVersion = await window.arkhon.getAppVersion()
    },

    /** 启动时同步当前运行模式 */
    async initCoreMode(): Promise<void> {
      try {
        const mode = await window.arkhon.getCoreMode()
        if (mode) this.coreMode = mode
      } catch {
        /* 未运行，保持默认 */
      }
    },

    /** 启动时拉取运行态日志快照 */
    async initLogs(): Promise<void> {
      try {
        const lines = await window.arkhon.getCoreLogs()
        if (lines.length) this.logs = lines.slice(-LOG_LIMIT)
      } catch {
        /* 忽略 */
      }
    },

    async refreshStatus(): Promise<void> {
      this.status = await window.arkhon.getCoreStatus()
    },

    setView(v: ViewKey): void {
      this.activeView = v
    },

    // ---------- 内核 ----------

    async start(): Promise<void> {
      this.busy = true
      this.logs = []
      try {
        this.status = await window.arkhon.startCore()
        await this.initCoreMode()
        await this.refreshProxies()
        if (!this.selectedGroup && this.groups.length > 0) this.selectedGroup = this.groups[0].name
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },

    /** 切换运行模式（rule/global/direct） */
    async setMode(mode: ProxyMode): Promise<void> {
      if (!this.running) {
        this.coreMode = mode
        return
      }
      try {
        await window.arkhon.setCoreMode(mode)
        this.coreMode = mode
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async stop(): Promise<void> {
      this.busy = true
      try {
        this.status = await window.arkhon.stopCore()
        this.proxies = []
        this.delays = {}
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },

    // ---------- 代理数据 ----------

    async refreshProxies(): Promise<void> {
      if (!this.running) return
      try {
        this.proxies = await window.arkhon.listProxies()
        if (!this.selectedGroup || !this.proxies.some((p) => p.nodeType === 2 && p.name === this.selectedGroup)) {
          const first = this.proxies.find((p) => p.nodeType === 2)
          this.selectedGroup = first?.name ?? ''
        }
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async switchNode(node: string): Promise<void> {
      const group = this.selectedGroup
      if (!group) return
      try {
        await window.arkhon.selectProxy(group, node)
        await this.refreshProxies()
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async testNode(name: string): Promise<void> {
      try {
        this.delays[name] = await window.arkhon.testDelay(
          name,
          this.delaySetting.url,
          this.delaySetting.timeoutMs
        )
      } catch (e) {
        this.delays[name] = { node: name, delay: -1, error: (e as Error).message }
      }
    },

    /** 保存测速配置（URL/超时）到本地持久化 */
    saveDelaySetting(url: string, timeoutMs: number): void {
      this.delaySetting = { url: url.trim() || 'https://www.gstatic.com/generate_204', timeoutMs }
      localStorage.setItem(DELAY_STORAGE_KEY, JSON.stringify(this.delaySetting))
    },

    /** 清空内核日志缓冲 */
    clearLogs(): void {
      this.logs = []
    },

    /** 批量测速（顺序执行，逐行反馈进度） */
    async testAllNodes(): Promise<void> {
      const group = this.currentGroup
      if (!group?.all) return
      const nodes = group.all
      this.batchTest = { running: true, current: 0, total: nodes.length }
      for (let i = 0; i < nodes.length; i++) {
        this.batchTest.current = i + 1
        await this.testNode(nodes[i])
      }
      this.batchTest = { running: false, current: 0, total: 0 }
    },

    // ---------- 订阅档案 ----------

    async refreshProfiles(): Promise<void> {
      this.profiles = await window.arkhon.listProfiles()
    },

    async importFromUrl(url: string): Promise<boolean> {
      if (!url.trim()) return false
      this.busy = true
      try {
        const { profile } = await window.arkhon.importProfileFromUrl(url.trim())
        await this.refreshProfiles()
        if (profile && !this.profiles.some((p) => p.selected)) {
          await this.selectProfile(profile.id, false)
        }
        return true
      } catch (e) {
        this.error = (e as Error).message
        return false
      } finally {
        this.busy = false
      }
    },

    async importFromText(name: string, content: string): Promise<boolean> {
      if (!content.trim()) return false
      this.busy = true
      try {
        const { profile } = await window.arkhon.importProfileFromText(name || '未命名订阅', content)
        await this.refreshProfiles()
        if (profile && !this.profiles.some((p) => p.selected)) {
          await this.selectProfile(profile.id, false)
        }
        return true
      } catch (e) {
        this.error = (e as Error).message
        return false
      } finally {
        this.busy = false
      }
    },

    async selectProfile(id: string, restart = true): Promise<void> {
      try {
        await window.arkhon.selectProfile(id)
        await this.refreshProfiles()
        if (restart && this.running) {
          this.status = await window.arkhon.startCore()
          await this.refreshProxies()
        }
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async removeProfile(id: string): Promise<void> {
      try {
        await window.arkhon.removeProfile(id)
        await this.refreshProfiles()
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async refreshProfile(id: string): Promise<void> {
      try {
        await window.arkhon.refreshProfile(id)
        await this.refreshProfiles()
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    // ---------- 系统代理 ----------

    async refreshSystemProxy(): Promise<void> {
      this.systemProxy = await window.arkhon.getSystemProxy()
    },

    async toggleSystemProxy(enabled: boolean): Promise<void> {
      try {
        this.systemProxy = await window.arkhon.setSystemProxy(enabled)
      } catch (e) {
        this.error = (e as Error).message
        this.systemProxy = { enabled: false }
      }
    },

    // ---------- TUN ----------

    async refreshTun(): Promise<void> {
      try {
        this.tunEnabled = await window.arkhon.getTunEnabled()
      } catch {
        this.tunEnabled = false
      }
    },

    /** 拉取 TUN 前置依赖（wintun 是否存在） */
    async refreshTunPrereq(): Promise<void> {
      try {
        this.tunPrereq = await window.arkhon.getTunPrereq()
      } catch {
        /* 忽略，保留默认值 */
      }
    },

    /** 切换 TUN（写配置 + 热重载；实际建卡需要管理员权限） */
    async toggleTun(enabled: boolean): Promise<void> {
      this.busy = true
      try {
        await window.arkhon.setTunEnabled(enabled)
        this.tunEnabled = enabled
        if (this.running) {
          await this.refreshStatus()
        }
      } catch (e) {
        this.error = (e as Error).message
        this.tunEnabled = !enabled
      } finally {
        this.busy = false
      }
    },

    // ---------- 系统服务 ----------

    async refreshService(): Promise<void> {
      try {
        this.serviceState = await window.arkhon.getServiceStatus()
      } catch {
        this.serviceState = { name: 'TeyvatArkhonCore', state: 'unknown' }
      }
    },

    async installService(): Promise<void> {
      this.busy = true
      try {
        this.serviceState = await window.arkhon.installService()
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },

    async uninstallService(): Promise<void> {
      this.busy = true
      try {
        this.serviceState = await window.arkhon.uninstallService()
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },

    // ---------- 连接管理 ----------

    async closeConnection(id: string): Promise<void> {
      try {
        await window.arkhon.closeConnection(id)
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    async closeAllConnections(): Promise<void> {
      try {
        await window.arkhon.closeAllConnections()
      } catch (e) {
        this.error = (e as Error).message
      }
    },

    // ---------- 外观 ----------

    setTheme(theme: Theme): void {
      this.theme = theme
      applyTheme(theme)
    },

    // ---------- 数据目录 ----------

    async refreshDataInfo(): Promise<void> {
      try {
        this.dataInfo = await window.arkhon.getDataInfo()
      } catch {
        /* 忽略 */
      }
    },

    async togglePortable(enabled: boolean): Promise<void> {
      try {
        const res = await window.arkhon.setPortable(enabled)
        this.dataInfo.portable = res.portable
        this.error = res.note
        setTimeout(() => (this.error = ''), 6000)
      } catch (e) {
        this.error = (e as Error).message
      }
    }
  }
})