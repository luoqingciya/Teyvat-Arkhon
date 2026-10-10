import { contextBridge, ipcRenderer } from 'electron'
import { EVT, IPC } from '@teyvat-arkhon/shared'
import type {
  ArkhonAPI,
  ClashConfigSummary,
  ConnectionInfo,
  CoreStatus,
  DelayResult,
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
  RuleProviderPreview,
  RuleTextParseResult,
  SystemProxyState,
  SystemServiceState,
  TrafficSnapshot,
  UiLanguage,
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
  getCoreStatus: () => invoke(IPC.coreGetStatus) as Promise<CoreStatus>,
  startCore: () => invoke(IPC.coreStart) as Promise<CoreStatus>,
  stopCore: () => invoke(IPC.coreStop) as Promise<CoreStatus>,
  setCoreMode: (mode) => invoke(IPC.coreSetMode, mode) as Promise<void>,
  getCoreMode: () => invoke(IPC.coreGetMode) as Promise<ProxyMode | undefined>,
  getCoreLogs: () => invoke(IPC.coreGetLogs) as Promise<string[]>,
  exportLogs: () => invoke(IPC.logsExport) as Promise<string | null>,

  closeConnection: (id) => invoke(IPC.coreCloseConnection, id) as Promise<void>,
  closeAllConnections: () => invoke(IPC.coreCloseAllConnections) as Promise<void>,

  subscribeConnections: () => invoke(IPC.connectionsSubscribe) as Promise<ConnectionInfo[]>,
  unsubscribeConnections: () => invoke(IPC.connectionsUnsubscribe) as Promise<void>,

  getActiveConfig: () => invoke(IPC.configGetActive) as Promise<string>,
  saveActiveConfig: (content) =>
    invoke(IPC.configSaveActive, content) as Promise<ClashConfigSummary>,

  getRuleEditorState: () => invoke(IPC.rulesEditorGet) as Promise<RuleEditorState>,
  saveRuleEditorState: (state, allowEmptyRules) =>
    invoke(IPC.rulesEditorSave, state, allowEmptyRules) as Promise<ClashConfigSummary>,
  parseRuleLines: (text) => invoke(IPC.rulesParseText, text) as Promise<RuleTextParseResult>,
  validateRuleLines: (rules) => invoke(IPC.rulesValidate, rules) as Promise<RuleLineValidation[]>,
  previewRuleProvider: (provider) =>
    invoke(IPC.rulesProviderPreview, provider) as Promise<RuleProviderPreview>,
  installRuleProvider: (provider) =>
    invoke(IPC.rulesProviderInstall, provider) as Promise<RuleEditorState>,
  debugRuleHit: (target, rules, providers) =>
    invoke(IPC.rulesDebugHit, target, rules, providers) as Promise<RuleDebugResult>,

  getDnsState: () => invoke(IPC.dnsGet) as Promise<DnsSettings>,
  saveDnsState: (settings) =>
    invoke(IPC.dnsSave, settings) as Promise<ClashConfigSummary>,

  getTunEnabled: () => invoke(IPC.coreGetTun) as Promise<boolean>,
  setTunEnabled: (enabled) =>
    invoke(IPC.coreSetTun, enabled) as Promise<ClashConfigSummary>,

  getServiceStatus: () => invoke(IPC.serviceStatus) as Promise<SystemServiceState>,
  installService: () => invoke(IPC.serviceInstall) as Promise<SystemServiceState>,
  uninstallService: () => invoke(IPC.serviceUninstall) as Promise<SystemServiceState>,

  listProxies: () => invoke(IPC.proxiesList) as Promise<ProxyItem[]>,
  listRules: () => invoke(IPC.rulesList) as Promise<RuleInfo[]>,
  selectProxy: (group, node) => invoke(IPC.proxiesSelect, group, node) as Promise<void>,
  testDelay: (name, url, timeoutMs) =>
    invoke(IPC.proxiesDelay, name, url, timeoutMs) as Promise<DelayResult>,
  listDelaySnapshot: () =>
    invoke(IPC.proxiesDelaySnapshot) as Promise<Record<string, number | null>>,

  listProfiles: () => invoke(IPC.profilesList) as Promise<Profile[]>,
  importProfileFromUrl: (url) =>
    invoke(IPC.profilesImportUrl, url) as Promise<{ profile: Profile; summary: ClashConfigSummary }>,
  importProfileFromText: (name, content) =>
    invoke(IPC.profilesImportText, name, content) as Promise<{
      profile: Profile
      summary: ClashConfigSummary
    }>,
  removeProfile: (id) => invoke(IPC.profilesRemove, id) as Promise<void>,
  refreshProfile: (id) => invoke(IPC.profilesRefresh, id) as Promise<Profile>,
  selectProfile: (id) => invoke(IPC.profilesSelect, id) as Promise<ClashConfigSummary>,
  exportProfileUris: (id) => invoke(IPC.profilesExportUris, id) as Promise<string>,
  refreshAllProfiles: () =>
    invoke(IPC.profilesRefreshAll) as Promise<{ ok: number; failed: number }>,

  runNetCheck: () => invoke(IPC.netCheck) as Promise<NetProbeResult[]>,

  getLoopbackState: () => invoke(IPC.loopbackStatus) as Promise<LoopbackState>,
  enableLoopbackExempt: () => invoke(IPC.loopbackEnable) as Promise<LoopbackState>,
  disableLoopbackExempt: () => invoke(IPC.loopbackDisable) as Promise<LoopbackState>,

  getAutoRefresh: () => invoke(IPC.appAutoRefreshGet) as Promise<boolean>,
  setAutoRefresh: (enabled) => invoke(IPC.appAutoRefreshSet, enabled) as Promise<void>,

  getExcludeKeywords: () => invoke(IPC.subExcludeGet) as Promise<string[]>,
  setExcludeKeywords: (keywords) => invoke(IPC.subExcludeSet, keywords) as Promise<void>,
  onProfilesChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(EVT.profilesChanged, listener)
    return () => ipcRenderer.removeListener(EVT.profilesChanged, listener)
  },

  getSystemProxy: () => invoke(IPC.systemProxyGet) as Promise<SystemProxyState>,
  setSystemProxy: (enabled) => invoke(IPC.systemProxySet, enabled) as Promise<SystemProxyState>,

  getAutoStart: () => invoke(IPC.appAutoStartGet) as Promise<boolean>,
  setAutoStart: (enabled) => invoke(IPC.appAutoStartSet, enabled) as Promise<boolean>,

  getAppVersion: () => invoke(IPC.appVersion) as Promise<string>,
  getDataInfo: () =>
    invoke(IPC.appDataInfo) as Promise<{ dataDir: string; portable: boolean }>,
  setPortable: (enabled) =>
    invoke(IPC.appSetPortable, enabled) as Promise<{ portable: boolean; note: string }>,

  getTunPrereq: () =>
    invoke(IPC.appGetTunPrereq) as Promise<{ wintun: boolean; windows: boolean }>,

  setLanguage: (lang) => invoke(IPC.appLanguageSet, lang) as Promise<UiLanguage>,

  getUpdateState: () => invoke(IPC.updateGetState) as Promise<UpdateState>,
  checkUpdate: () => invoke(IPC.updateCheck) as Promise<UpdateState>,
  installUpdate: () => invoke(IPC.updateInstall) as Promise<void>,
  setAutoUpdate: (enabled) => invoke(IPC.appUpdateAutoSet, enabled) as Promise<boolean>,
  onUpdateState: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => cb(state)
    ipcRenderer.on(EVT.update, listener)
    return () => ipcRenderer.removeListener(EVT.update, listener)
  },

  onStateChange: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: CoreStatus): void => cb(status)
    ipcRenderer.on(EVT.state, listener)
    return () => ipcRenderer.removeListener(EVT.state, listener)
  },
  onTraffic: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: TrafficSnapshot): void => cb(snapshot)
    ipcRenderer.on(EVT.traffic, listener)
    return () => ipcRenderer.removeListener(EVT.traffic, listener)
  },
  onConnections: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, connections: ConnectionInfo[]): void =>
      cb(connections)
    ipcRenderer.on(EVT.connections, listener)
    return () => ipcRenderer.removeListener(EVT.connections, listener)
  },
  onError: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on(EVT.error, listener)
    return () => ipcRenderer.removeListener(EVT.error, listener)
  },
  onCoreLog: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, lines: string[]): void => cb(lines)
    ipcRenderer.on(EVT.log, listener)
    return () => ipcRenderer.removeListener(EVT.log, listener)
  }
}

contextBridge.exposeInMainWorld('arkhon', api)