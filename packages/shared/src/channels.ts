/**
 * IPC 通道名的**唯一来源**。
 *
 * 此前通道名以字符串字面量分别写在 preload（invoke/on）与主进程（handle/send）两侧，
 * 类型检查覆盖不到：改名或打错只会静默失效（曾出现 `app:update-auto-get` 这类
 * 有 handler 无调用方的死通道）。集中到此处后两侧引用同一常量，改名即编译期报错。
 *
 * 约定：
 *  - `IPC`  请求/应答通道（渲染端 invoke ↔ 主进程 ipcMain.handle）
 *  - `EVT`  主进程 → 渲染端单向推送（webContents.send ↔ preload 的 ipcRenderer.on）
 *  - 键名用「域 + 动作」的 camelCase，值保持历史通道串以兼容既有调试习惯
 */

/** 请求/应答通道（invoke ↔ handle） */
export const IPC = {
  // ---------- 应用 ----------
  appVersion: 'app:version',
  appDataInfo: 'app:data-info',
  appSetPortable: 'app:set-portable',
  appGetTunPrereq: 'app:get-tun-prereq',
  appLanguageSet: 'app:language-set',
  appAutoRefreshGet: 'app:auto-refresh-get',
  appAutoRefreshSet: 'app:auto-refresh-set',
  appAutoStartGet: 'app:auto-start-get',
  appAutoStartSet: 'app:auto-start-set',
  appUpdateAutoSet: 'app:update-auto-set',

  // ---------- 内核 ----------
  coreStart: 'core:start',
  coreStop: 'core:stop',
  coreGetStatus: 'core:get-status',
  coreGetLogs: 'core:get-logs',
  coreGetMode: 'core:get-mode',
  coreSetMode: 'core:set-mode',
  coreGetTun: 'core:get-tun',
  coreSetTun: 'core:set-tun',
  coreCloseConnection: 'core:close-connection',
  coreCloseAllConnections: 'core:close-all-connections',

  // ---------- 连接 ----------
  connectionsSubscribe: 'connections:subscribe',
  connectionsUnsubscribe: 'connections:unsubscribe',

  // ---------- 配置 ----------
  configGetActive: 'config:get-active',
  configSaveActive: 'config:save-active',

  // ---------- 订阅档案 ----------
  profilesList: 'profiles:list',
  profilesImportUrl: 'profiles:import-url',
  profilesImportText: 'profiles:import-text',
  profilesRemove: 'profiles:remove',
  profilesSelect: 'profiles:select',
  profilesRefresh: 'profiles:refresh',
  profilesRefreshAll: 'profiles:refresh-all',
  profilesExportUris: 'profiles:export-uris',

  // ---------- 代理 ----------
  proxiesList: 'proxies:list',
  proxiesSelect: 'proxies:select',
  proxiesDelay: 'proxies:delay',
  proxiesDelaySnapshot: 'proxies:delay-snapshot',

  // ---------- 分流规则 ----------
  rulesEditorGet: 'rules:editor-get',
  rulesEditorSave: 'rules:editor-save',
  rulesParseText: 'rules:parse-text',
  rulesValidate: 'rules:validate',
  rulesProviderPreview: 'rules:provider-preview',
  rulesProviderInstall: 'rules:provider-install',
  rulesDebugHit: 'rules:debug-hit',
  rulesList: 'rules:list',

  // ---------- DNS 分流 ----------
  dnsGet: 'dns:get',
  dnsSave: 'dns:save',

  // ---------- 系统代理 ----------
  systemProxyGet: 'system-proxy:get',
  systemProxySet: 'system-proxy:set',

  // ---------- 系统服务 ----------
  serviceStatus: 'service:status',
  serviceInstall: 'service:install',
  serviceUninstall: 'service:uninstall',

  // ---------- UWP 回环豁免 ----------
  loopbackStatus: 'loopback:status',
  loopbackEnable: 'loopback:enable',
  loopbackDisable: 'loopback:disable',

  // ---------- 网络自检 ----------
  netCheck: 'net:check',

  // ---------- 日志 ----------
  logsExport: 'logs:export',

  // ---------- 订阅设置 ----------
  subExcludeGet: 'sub:exclude-get',
  subExcludeSet: 'sub:exclude-set',

  // ---------- 应用更新 ----------
  updateCheck: 'update:check',
  updateGetState: 'update:get-state',
  updateInstall: 'update:install'
} as const

/** 主进程 → 渲染端 的单向推送通道 */
export const EVT = {
  /** 内核状态变化 */
  state: 'arkhon:state',
  /** 主进程错误提示（渲染端以 toast 展示） */
  error: 'arkhon:error',
  /** 内核日志批量推送 */
  log: 'arkhon:log',
  /** 档案列表变化（托盘切换档案后通知渲染端刷新） */
  profilesChanged: 'arkhon:profiles-changed',
  /** 实时流量轻量快照 */
  traffic: 'arkhon:traffic',
  /** 连接明细（仅订阅期间推送） */
  connections: 'arkhon:connections',
  /** 应用更新状态 */
  update: 'arkhon:update'
} as const
