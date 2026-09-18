import { contextBridge, ipcRenderer } from 'electron'
import type {
  ArkhonAPI,
  ClashConfigSummary,
  ConnectionInfo,
  CoreStatus,
  DelayResult,
  DnsPresetMeta,
  DnsSettings,
  LoopbackState,
  NetProbeResult,
  Profile,
  ProxyItem,
  ProxyMode,
  RuleDebugResult,
  RuleEditorState,
  RuleInfo,
  RuleLineValidation,
  RulePresetMeta,
  RuleProviderPreview,
  SystemProxyState,
  SystemServiceState,
  TrafficSnapshot,
  UpdateState
} from '@teyvat-arkhon/shared'

/**
 * invoke 参数清洗：Vue 3 reactive Proxy 无法被 Electron 结构化克隆
 * （报 "An object could not be cloned"），统一转纯对象后传递。
 */
const toPlain = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v
  try {
    return JSON.parse(JSON.stringify(v)) as unknown
  } catch {
    return v
  }
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args.map(toPlain)) as Promise<T>

const api: ArkhonAPI = {
  getCoreStatus: () => invoke('core:get-status') as Promise<CoreStatus>,
  startCore: () => invoke('core:start') as Promise<CoreStatus>,
  stopCore: () => invoke('core:stop') as Promise<CoreStatus>,
  setCoreMode: (mode) => invoke('core:set-mode', mode) as Promise<void>,
  getCoreMode: () => invoke('core:get-mode') as Promise<ProxyMode | undefined>,
  getCoreLogs: () => invoke('core:get-logs') as Promise<string[]>,
  exportLogs: () => invoke('logs:export') as Promise<string | null>,

  getConnections: () =>
    invoke('core:get-connections') as Promise<{
      downloadTotal: number
      uploadTotal: number
      connections: ConnectionInfo[]
    }>,
  closeConnection: (id) => invoke('core:close-connection', id) as Promise<void>,
  closeAllConnections: () => invoke('core:close-all-connections') as Promise<void>,

  getActiveConfig: () => invoke('config:get-active') as Promise<string>,
  saveActiveConfig: (content) =>
    invoke('config:save-active', content) as Promise<ClashConfigSummary>,

  getRuleEditorState: () => invoke('rules:editor-get') as Promise<RuleEditorState>,
  saveRuleEditorState: (state) =>
    invoke('rules:editor-save', state) as Promise<ClashConfigSummary>,
  validateRuleLines: (rules) => invoke('rules:validate', rules) as Promise<RuleLineValidation[]>,
  previewRuleProvider: (provider) =>
    invoke('rules:provider-preview', provider) as Promise<RuleProviderPreview>,
  installRuleProvider: (provider) =>
    invoke('rules:provider-install', provider) as Promise<RuleEditorState>,
  debugRuleHit: (target, rules, providers) =>
    invoke('rules:debug-hit', target, rules, providers) as Promise<RuleDebugResult>,
  listRulePresets: () => invoke('rules:presets') as Promise<RulePresetMeta[]>,

  getDnsState: () => invoke('dns:get') as Promise<DnsSettings>,
  saveDnsState: (settings) =>
    invoke('dns:save', settings) as Promise<ClashConfigSummary>,
  listDnsPresets: () => invoke('dns:presets') as Promise<DnsPresetMeta[]>,

  getTunEnabled: () => invoke('core:get-tun') as Promise<boolean>,
  setTunEnabled: (enabled) =>
    invoke('core:set-tun', enabled) as Promise<ClashConfigSummary>,

  getServiceStatus: () => invoke('service:status') as Promise<SystemServiceState>,
  installService: () => invoke('service:install') as Promise<SystemServiceState>,
  uninstallService: () => invoke('service:uninstall') as Promise<SystemServiceState>,

  listProxies: () => invoke('proxies:list') as Promise<ProxyItem[]>,
  listRules: () => invoke('rules:list') as Promise<RuleInfo[]>,
  selectProxy: (group, node) => invoke('proxies:select', group, node) as Promise<void>,
  testDelay: (name, url, timeoutMs) =>
    invoke('proxies:delay', name, url, timeoutMs) as Promise<DelayResult>,
  listDelaySnapshot: () =>
    invoke('proxies:delay-snapshot') as Promise<Record<string, number | null>>,

  listProfiles: () => invoke('profiles:list') as Promise<Profile[]>,
  importProfileFromUrl: (url) =>
    invoke('profiles:import-url', url) as Promise<{ profile: Profile; summary: ClashConfigSummary }>,
  importProfileFromText: (name, content) =>
    invoke('profiles:import-text', name, content) as Promise<{
      profile: Profile
      summary: ClashConfigSummary
    }>,
  removeProfile: (id) => invoke('profiles:remove', id) as Promise<void>,
  refreshProfile: (id) => invoke('profiles:refresh', id) as Promise<Profile>,
  selectProfile: (id) => invoke('profiles:select', id) as Promise<ClashConfigSummary>,
  exportProfileUris: (id) => invoke('profiles:export-uris', id) as Promise<string>,
  refreshAllProfiles: () =>
    invoke('profiles:refresh-all') as Promise<{ ok: number; failed: number }>,

  runNetCheck: () => invoke('net:check') as Promise<NetProbeResult[]>,

  getLoopbackState: () => invoke('loopback:status') as Promise<LoopbackState>,
  enableLoopbackExempt: () => invoke('loopback:enable') as Promise<LoopbackState>,
  disableLoopbackExempt: () => invoke('loopback:disable') as Promise<LoopbackState>,

  getAutoRefresh: () => invoke('app:auto-refresh-get') as Promise<boolean>,
  setAutoRefresh: (enabled) => invoke('app:auto-refresh-set', enabled) as Promise<void>,

  getExcludeKeywords: () => invoke('sub:exclude-get') as Promise<string[]>,
  setExcludeKeywords: (keywords) => invoke('sub:exclude-set', keywords) as Promise<void>,
  onProfilesChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('arkhon:profiles-changed', listener)
    return () => ipcRenderer.removeListener('arkhon:profiles-changed', listener)
  },

  getSystemProxy: () => invoke('system-proxy:get') as Promise<SystemProxyState>,
  setSystemProxy: (enabled) => invoke('system-proxy:set', enabled) as Promise<SystemProxyState>,

  getAutoStart: () => invoke('app:auto-start-get') as Promise<boolean>,
  setAutoStart: (enabled) => invoke('app:auto-start-set', enabled) as Promise<boolean>,

  getAppVersion: () => invoke('app:version') as Promise<string>,
  getDataInfo: () =>
    invoke('app:data-info') as Promise<{ dataDir: string; portable: boolean }>,
  setPortable: (enabled) =>
    invoke('app:set-portable', enabled) as Promise<{ portable: boolean; note: string }>,

  getTunPrereq: () =>
    invoke('app:get-tun-prereq') as Promise<{ wintun: boolean; windows: boolean }>,

  getUpdateState: () => invoke('update:get-state') as Promise<UpdateState>,
  checkUpdate: () => invoke('update:check') as Promise<UpdateState>,
  installUpdate: () => invoke('update:install') as Promise<void>,
  setAutoUpdate: (enabled) => invoke('app:update-auto-set', enabled) as Promise<boolean>,
  onUpdateState: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => cb(state)
    ipcRenderer.on('arkhon:update', listener)
    return () => ipcRenderer.removeListener('arkhon:update', listener)
  },

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