import type {
  ClashConfigSummary,
  ConnectionInfo,
  CoreStatus,
  DelayResult,
  Profile,
  ProxyItem,
  ProxyMode,
  SystemProxyState,
  SystemServiceState,
  TrafficSnapshot
} from './types'

/**
 * 渲染进程可见的桥接 API（contextBridge 暴露为 window.arkhon）。
 * 主进程 IPC 处理器与该接口一一对应，见 apps/electron/src/main/ipc.ts。
 */
export interface ArkhonAPI {
  // ---------- 内核控制 ----------
  getCoreStatus(): Promise<CoreStatus>
  startCore(): Promise<CoreStatus>
  stopCore(): Promise<CoreStatus>
  setCoreMode(mode: ProxyMode): Promise<void>
  getCoreMode(): Promise<ProxyMode | undefined>
  getCoreLogs(): Promise<string[]>

  // ---------- 实时连接与流量 ----------
  getConnections(): Promise<{
    downloadTotal: number
    uploadTotal: number
    connections: ConnectionInfo[]
  }>
  closeConnection(id: string): Promise<void>
  closeAllConnections(): Promise<void>

  // ---------- 配置编辑器 ----------
  getActiveConfig(): Promise<string>
  saveActiveConfig(content: string): Promise<ClashConfigSummary>

  // ---------- TUN 模式 ----------
  getTunEnabled(): Promise<boolean>
  setTunEnabled(enabled: boolean): Promise<ClashConfigSummary>

  // ---------- 系统服务 ----------
  getServiceStatus(): Promise<SystemServiceState>
  installService(): Promise<SystemServiceState>
  uninstallService(): Promise<SystemServiceState>

  // ---------- 代理数据 ----------
  listProxies(): Promise<ProxyItem[]>
  selectProxy(groupName: string, nodeName: string): Promise<void>
  testDelay(name: string, url?: string, timeoutMs?: number): Promise<DelayResult>

  // ---------- 订阅档案 ----------
  listProfiles(): Promise<Profile[]>
  importProfileFromUrl(url: string): Promise<{ profile: Profile; summary: ClashConfigSummary }>
  importProfileFromText(name: string, content: string): Promise<{ profile: Profile; summary: ClashConfigSummary }>
  removeProfile(id: string): Promise<void>
  refreshProfile(id: string): Promise<Profile>
  selectProfile(id: string): Promise<ClashConfigSummary>

  // ---------- 系统代理 ----------
  getSystemProxy(): Promise<SystemProxyState>
  setSystemProxy(enabled: boolean): Promise<SystemProxyState>

  // ---------- 应用 ----------
  getAppVersion(): Promise<string>
  getDataInfo(): Promise<{ dataDir: string; portable: boolean }>
  setPortable(enabled: boolean): Promise<{ portable: boolean; note: string }>
  getTunPrereq(): Promise<{ wintun: boolean; windows: boolean }>

  // ---------- 事件订阅（返回取消函数） ----------
  onStateChange(cb: (status: CoreStatus) => void): () => void
  onTraffic(cb: (snapshot: TrafficSnapshot) => void): () => void
  onError(cb: (message: string) => void): () => void
  onCoreLog(cb: (line: string) => void): () => void
}