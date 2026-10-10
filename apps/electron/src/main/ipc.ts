import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { EVT, IPC } from '@teyvat-arkhon/shared'
import type { CoreStatus, ProxyMode, SystemProxyState, UiLanguage } from '@teyvat-arkhon/shared'
import type { CoreService } from '@teyvat-arkhon/core-bridge'
import type { SystemProxyController } from './system-proxy'
import type { WindowsServiceManager } from './system-service'
import type { NetChecker } from './net-check'
import type { LoopbackController } from './system-loopback'
import type { UpdateManager } from './updater'
import type { TrafficMonitor } from './traffic-monitor'
import { setPortableEnabled, isPortableMode } from './paths'
import { t } from './i18n'

/**
 * 主进程 IPC 依赖集合。
 * 用 options 对象承载而非 16 个位置参数：新增依赖时不必关心参数顺序，
 * 避免"插错位置"这类类型检查之外的失误。
 */
export interface IpcDeps {
  service: CoreService
  systemProxy: SystemProxyController
  serviceManager: WindowsServiceManager
  /** TUN 前置依赖探测：wintun.dll 是否可用 */
  tunPrereq: () => boolean
  netChecker: NetChecker
  loopback: LoopbackController
  getAutoRefresh: () => boolean
  setAutoRefresh: (enabled: boolean) => void
  getExcludeKeywords: () => string[]
  setExcludeKeywords: (keywords: string[]) => void
  getAutoStart: () => boolean
  setAutoStart: (enabled: boolean) => boolean
  updateManager: UpdateManager
  setAutoUpdate: (enabled: boolean) => boolean
  setLanguage: (lang: UiLanguage) => UiLanguage
  trafficMonitor: TrafficMonitor
}

/** 注册全部 IPC 处理器，并把主进程事件（状态/错误/日志）推送到渲染进程 */
export function createIpc(deps: IpcDeps): void {
  const {
    service,
    systemProxy,
    serviceManager,
    tunPrereq,
    netChecker,
    loopback,
    getAutoRefresh,
    setAutoRefresh,
    getExcludeKeywords,
    setExcludeKeywords,
    getAutoStart,
    setAutoStart,
    updateManager,
    setAutoUpdate,
    setLanguage,
    trafficMonitor
  } = deps

  service.on('state-change', (status: CoreStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(EVT.state, status)
    }
  })
  service.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(EVT.error, msg)
    }
  })
  // 内核日志按时间窗口批量推送（单次携带多行），避免逐行 IPC 洪泛
  service.on('core-logs', (lines: string[]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(EVT.log, lines)
    }
  })

  ipcMain.handle(IPC.coreGetStatus, () => service.status())
  ipcMain.handle(IPC.coreStart, () => service.start())
  ipcMain.handle(IPC.coreStop, () => service.stop())
  ipcMain.handle(IPC.coreSetMode, (_e, mode: ProxyMode) => service.setMode(mode))
  ipcMain.handle(IPC.coreGetMode, () => service.getMode())
  ipcMain.handle(IPC.coreGetLogs, () => service.getLogs())

  ipcMain.handle(IPC.coreCloseConnection, (_e, id: string) => service.closeConnection(id))
  ipcMain.handle(IPC.coreCloseAllConnections, () => service.closeAllConnections())
  // 连接明细订阅（连接页挂载/卸载时调用）：主进程据此开关明细推送
  ipcMain.handle(IPC.connectionsSubscribe, () => trafficMonitor.subscribeConnections())
  ipcMain.handle(IPC.connectionsUnsubscribe, () => {
    trafficMonitor.unsubscribeConnections()
  })

  ipcMain.handle(IPC.configGetActive, () => service.getActiveConfig())
  ipcMain.handle(IPC.configSaveActive, (_e, content: string) => service.saveActiveConfig(content))

  // 可视化分流规则编辑器
  ipcMain.handle(IPC.rulesEditorGet, () => service.getRuleEditorState())
  ipcMain.handle(IPC.rulesEditorSave, (_e, state, allowEmptyRules?: boolean) =>
    service.saveRuleEditorState(state, allowEmptyRules === true)
  )
  ipcMain.handle(IPC.rulesParseText, (_e, text: string) => service.parseRuleLines(text))
  ipcMain.handle(IPC.rulesValidate, (_e, rules) => service.validateRuleLines(rules))
  ipcMain.handle(IPC.rulesProviderPreview, (_e, provider) => service.previewRuleProvider(provider))
  ipcMain.handle(IPC.rulesProviderInstall, (_e, provider) => service.installRuleProvider(provider))
  ipcMain.handle(IPC.rulesDebugHit, (_e, target: string, rules, providers) =>
    service.debugRuleMatch(target, rules, providers)
  )

  // DNS 分流联动
  ipcMain.handle(IPC.dnsGet, () => service.getDnsState())
  ipcMain.handle(IPC.dnsSave, (_e, settings) => service.saveDnsState(settings))

  ipcMain.handle(IPC.coreGetTun, () => service.getTunEnabled())
  ipcMain.handle(IPC.coreSetTun, (_e, enabled: boolean) => service.setTunEnabled(enabled))

  ipcMain.handle(IPC.serviceStatus, () => serviceManager.status())
  ipcMain.handle(IPC.serviceInstall, () => serviceManager.install())
  ipcMain.handle(IPC.serviceUninstall, async () => {
    const st = await serviceManager.uninstall()
    // 服务卸载后内核已停止：把驱动切回应用进程模式（重新 spawn 内核接管），
    // 避免界面停留在「服务接管但有 REST 已断」的悬空状态。
    if (service.status().driver === 'service') {
      await service.setDriverConfig(serviceManager.getProcessDriverConfig())
    }
    return st
  })

  // ---------- 日志导出 ----------
  ipcMain.handle(IPC.logsExport, async (): Promise<string | null> => {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.exportLogs.title'),
      defaultPath: `arkhon-logs-${ts}.log`,
      filters: [{ name: t('dialog.exportLogs.filter'), extensions: ['log', 'txt'] }]
    })
    if (canceled || !filePath) return null
    const content = service.getLogs().join('\n') + '\n'
    await (await import('node:fs')).promises.writeFile(filePath, content, 'utf-8')
    return filePath
  })

  ipcMain.handle(IPC.proxiesList, () => service.listProxies())
  ipcMain.handle(IPC.rulesList, () => service.listRules())
  ipcMain.handle(IPC.proxiesSelect, (_e, group: string, node: string) => service.selectProxy(group, node))
  ipcMain.handle(IPC.proxiesDelay, (_e, name: string, url?: string, timeoutMs?: number) =>
    service.testDelay(name, url, timeoutMs)
  )
  ipcMain.handle(IPC.proxiesDelaySnapshot, () => service.listDelaySnapshot())

  ipcMain.handle(IPC.profilesList, () => service.listProfiles())
  ipcMain.handle(IPC.profilesImportUrl, (_e, url: string) => service.importFromUrl(url))
  ipcMain.handle(IPC.profilesImportText, (_e, name: string, content: string) => service.importFromText(name, content))
  ipcMain.handle(IPC.profilesRemove, (_e, id: string) => service.removeProfile(id))
  ipcMain.handle(IPC.profilesRefresh, (_e, id: string) => service.refreshProfile(id))
  ipcMain.handle(IPC.profilesSelect, (_e, id: string) => service.selectProfile(id))
  ipcMain.handle(IPC.profilesExportUris, (_e, id: string) => service.exportProfileUris(id))
  ipcMain.handle(IPC.profilesRefreshAll, () => service.refreshAllUrlProfiles())

  ipcMain.handle(IPC.netCheck, () => netChecker.run())

  ipcMain.handle(IPC.loopbackStatus, () => loopback.status())
  ipcMain.handle(IPC.loopbackEnable, () => loopback.enable())
  ipcMain.handle(IPC.loopbackDisable, () => loopback.disable())

  ipcMain.handle(IPC.appAutoRefreshGet, () => getAutoRefresh())
  ipcMain.handle(IPC.appAutoRefreshSet, (_e, enabled: boolean) => setAutoRefresh(enabled))

  ipcMain.handle(IPC.subExcludeGet, () => getExcludeKeywords())
  ipcMain.handle(IPC.subExcludeSet, (_e, keywords: string[]) => setExcludeKeywords(Array.isArray(keywords) ? keywords : []))

  ipcMain.handle(IPC.systemProxyGet, async (): Promise<SystemProxyState> => systemProxy.read())
  ipcMain.handle(IPC.systemProxySet, async (_e, enabled: boolean): Promise<SystemProxyState> => systemProxy.set(enabled))

  ipcMain.handle(IPC.appAutoStartGet, () => getAutoStart())
  ipcMain.handle(IPC.appAutoStartSet, (_e, enabled: boolean) => setAutoStart(enabled === true))

  // 渲染端同步界面语言（托盘/原生对话框/自检结果文案跟随）
  ipcMain.handle(IPC.appLanguageSet, (_e, lang: UiLanguage) => setLanguage(lang))

  ipcMain.handle(IPC.appVersion, () => app.getVersion())

  ipcMain.handle(IPC.appDataInfo, () => ({
    dataDir: app.getPath('userData'),
    portable: isPortableMode(app)
  }))
  ipcMain.handle(IPC.appSetPortable, (_e, enabled: boolean) => setPortableEnabled(app, enabled))
  ipcMain.handle(IPC.appGetTunPrereq, () => ({
    wintun: tunPrereq(),
    windows: process.platform === 'win32'
  }))

  // ---------- 应用更新（设置页） ----------
  ipcMain.handle(IPC.updateGetState, () => updateManager.getState())
  ipcMain.handle(IPC.updateCheck, () => updateManager.checkNow())
  ipcMain.handle(IPC.updateInstall, () => updateManager.installNow())
  ipcMain.handle(IPC.appUpdateAutoSet, (_e, enabled: boolean) => setAutoUpdate(enabled === true))
}