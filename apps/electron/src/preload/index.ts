import { contextBridge, ipcRenderer } from 'electron'
import type {
  ArkhonAPI,
  ClashConfigSummary,
  ConnectionInfo,
  CoreStatus,
  DelayResult,
  LoopbackState,
  NetProbeResult,
  Profile,
  ProxyItem,
  ProxyMode,
  RuleInfo,
  SystemProxyState,
  SystemServiceState,
  TrafficSnapshot
} from '@teyvat-arkhon/shared'

const api: ArkhonAPI = {
  getCoreStatus: () => ipcRenderer.invoke('core:get-status') as Promise<CoreStatus>,
  startCore: () => ipcRenderer.invoke('core:start') as Promise<CoreStatus>,
  stopCore: () => ipcRenderer.invoke('core:stop') as Promise<CoreStatus>,
  setCoreMode: (mode) => ipcRenderer.invoke('core:set-mode', mode) as Promise<void>,
  getCoreMode: () => ipcRenderer.invoke('core:get-mode') as Promise<ProxyMode | undefined>,
  getCoreLogs: () => ipcRenderer.invoke('core:get-logs') as Promise<string[]>,

  getConnections: () =>
    ipcRenderer.invoke('core:get-connections') as Promise<{
      downloadTotal: number
      uploadTotal: number
      connections: ConnectionInfo[]
    }>,
  closeConnection: (id) => ipcRenderer.invoke('core:close-connection', id) as Promise<void>,
  closeAllConnections: () => ipcRenderer.invoke('core:close-all-connections') as Promise<void>,

  getActiveConfig: () => ipcRenderer.invoke('config:get-active') as Promise<string>,
  saveActiveConfig: (content) =>
    ipcRenderer.invoke('config:save-active', content) as Promise<ClashConfigSummary>,

  getTunEnabled: () => ipcRenderer.invoke('core:get-tun') as Promise<boolean>,
  setTunEnabled: (enabled) =>
    ipcRenderer.invoke('core:set-tun', enabled) as Promise<ClashConfigSummary>,

  getServiceStatus: () => ipcRenderer.invoke('service:status') as Promise<SystemServiceState>,
  installService: () => ipcRenderer.invoke('service:install') as Promise<SystemServiceState>,
  uninstallService: () => ipcRenderer.invoke('service:uninstall') as Promise<SystemServiceState>,

  listProxies: () => ipcRenderer.invoke('proxies:list') as Promise<ProxyItem[]>,
  listRules: () => ipcRenderer.invoke('rules:list') as Promise<RuleInfo[]>,
  selectProxy: (group, node) => ipcRenderer.invoke('proxies:select', group, node) as Promise<void>,
  testDelay: (name, url, timeoutMs) =>
    ipcRenderer.invoke('proxies:delay', name, url, timeoutMs) as Promise<DelayResult>,

  listProfiles: () => ipcRenderer.invoke('profiles:list') as Promise<Profile[]>,
  importProfileFromUrl: (url) =>
    ipcRenderer.invoke('profiles:import-url', url) as Promise<{ profile: Profile; summary: ClashConfigSummary }>,
  importProfileFromText: (name, content) =>
    ipcRenderer.invoke('profiles:import-text', name, content) as Promise<{
      profile: Profile
      summary: ClashConfigSummary
    }>,
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id) as Promise<void>,
  refreshProfile: (id) => ipcRenderer.invoke('profiles:refresh', id) as Promise<Profile>,
  selectProfile: (id) => ipcRenderer.invoke('profiles:select', id) as Promise<ClashConfigSummary>,
  exportProfileUris: (id) => ipcRenderer.invoke('profiles:export-uris', id) as Promise<string>,
  refreshAllProfiles: () =>
    ipcRenderer.invoke('profiles:refresh-all') as Promise<{ ok: number; failed: number }>,

  runNetCheck: () => ipcRenderer.invoke('net:check') as Promise<NetProbeResult[]>,

  getLoopbackState: () => ipcRenderer.invoke('loopback:status') as Promise<LoopbackState>,
  enableLoopbackExempt: () => ipcRenderer.invoke('loopback:enable') as Promise<LoopbackState>,
  disableLoopbackExempt: () => ipcRenderer.invoke('loopback:disable') as Promise<LoopbackState>,

  getAutoRefresh: () => ipcRenderer.invoke('app:auto-refresh-get') as Promise<boolean>,
  setAutoRefresh: (enabled) => ipcRenderer.invoke('app:auto-refresh-set', enabled) as Promise<void>,

  getExcludeKeywords: () => ipcRenderer.invoke('sub:exclude-get') as Promise<string[]>,
  setExcludeKeywords: (keywords) => ipcRenderer.invoke('sub:exclude-set', keywords) as Promise<void>,
  onProfilesChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('arkhon:profiles-changed', listener)
    return () => ipcRenderer.removeListener('arkhon:profiles-changed', listener)
  },

  getSystemProxy: () => ipcRenderer.invoke('system-proxy:get') as Promise<SystemProxyState>,
  setSystemProxy: (enabled) => ipcRenderer.invoke('system-proxy:set', enabled) as Promise<SystemProxyState>,

  getAppVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  getDataInfo: () =>
    ipcRenderer.invoke('app:data-info') as Promise<{ dataDir: string; portable: boolean }>,
  setPortable: (enabled) =>
    ipcRenderer.invoke('app:set-portable', enabled) as Promise<{ portable: boolean; note: string }>,

  getTunPrereq: () =>
    ipcRenderer.invoke('app:get-tun-prereq') as Promise<{ wintun: boolean; windows: boolean }>,

  onStateChange: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: CoreStatus): void => cb(status)
    ipcRenderer.on('arkhon:state', listener)
    return () => ipcRenderer.removeListener('arkhon:state', listener)
  },
  onTraffic: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: TrafficSnapshot): void => cb(snapshot)
    ipcRenderer.on('arkhon:traffic', listener)
    return () => ipcRenderer.removeListener('arkhon:traffic', listener)
  },
  onError: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('arkhon:error', listener)
    return () => ipcRenderer.removeListener('arkhon:error', listener)
  },
  onCoreLog: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, line: string): void => cb(line)
    ipcRenderer.on('arkhon:log', listener)
    return () => ipcRenderer.removeListener('arkhon:log', listener)
  }
}

contextBridge.exposeInMainWorld('arkhon', api)