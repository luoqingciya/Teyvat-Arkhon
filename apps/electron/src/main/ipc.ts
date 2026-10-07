import { BrowserWindow, app, dialog, ipcMain } from 'electron'
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
      win.webContents.send('arkhon:state', status)
    }
  })
  service.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('arkhon:error', msg)
    }
  })
  // 内核日志按时间窗口批量推送（单次携带多行），避免逐行 IPC 洪泛
  service.on('core-logs', (lines: string[]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('arkhon:log', lines)
    }
  })

  ipcMain.handle('core:get-status', () => service.status())
  ipcMain.handle('core:start', () => service.start())
  ipcMain.handle('core:stop', () => service.stop())
  ipcMain.handle('core:set-mode', (_e, mode: ProxyMode) => service.setMode(mode))
  ipcMain.handle('core:get-mode', () => service.getMode())
  ipcMain.handle('core:get-logs', () => service.getLogs())

  ipcMain.handle('core:get-connections', () => service.getConnections())
  ipcMain.handle('core:close-connection', (_e, id: string) => service.closeConnection(id))
  ipcMain.handle('core:close-all-connections', () => service.closeAllConnections())
  // 连接明细订阅（连接页挂载/卸载时调用）：主进程据此开关明细推送
  ipcMain.handle('connections:subscribe', () => trafficMonitor.subscribeConnections())
  ipcMain.handle('connections:unsubscribe', () => {
    trafficMonitor.unsubscribeConnections()
  })

  ipcMain.handle('config:get-active', () => service.getActiveConfig())
  ipcMain.handle('config:save-active', (_e, content: string) => service.saveActiveConfig(content))

  // 可视化分流规则编辑器
  ipcMain.handle('rules:editor-get', () => service.getRuleEditorState())
  ipcMain.handle('rules:editor-save', (_e, state) => service.saveRuleEditorState(state))
  ipcMain.handle('rules:validate', (_e, rules) => service.validateRuleLines(rules))
  ipcMain.handle('rules:provider-preview', (_e, provider) => service.previewRuleProvider(provider))
  ipcMain.handle('rules:provider-install', (_e, provider) => service.installRuleProvider(provider))
  ipcMain.handle('rules:debug-hit', (_e, target: string, rules, providers) =>
    service.debugRuleMatch(target, rules, providers)
  )
  ipcMain.handle('rules:presets', () => service.listRulePresets())

  // DNS 分流联动
  ipcMain.handle('dns:get', () => service.getDnsState())
  ipcMain.handle('dns:save', (_e, settings) => service.saveDnsState(settings))
  ipcMain.handle('dns:presets', () => service.listDnsPresets())

  ipcMain.handle('core:get-tun', () => service.getTunEnabled())
  ipcMain.handle('core:set-tun', (_e, enabled: boolean) => service.setTunEnabled(enabled))

  ipcMain.handle('service:status', () => serviceManager.status())
  ipcMain.handle('service:install', () => serviceManager.install())
  ipcMain.handle('service:uninstall', async () => {
    const st = await serviceManager.uninstall()
    // 服务卸载后内核已停止：把驱动切回应用进程模式（重新 spawn 内核接管），
    // 避免界面停留在「服务接管但有 REST 已断」的悬空状态。
    if (service.status().driver === 'service') {
      await service.setDriverConfig(serviceManager.getProcessDriverConfig())
    }
    return st
  })

  // ---------- 日志导出 ----------
  ipcMain.handle('logs:export', async (): Promise<string | null> => {
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

  ipcMain.handle('proxies:list', () => service.listProxies())
  ipcMain.handle('rules:list', () => service.listRules())
  ipcMain.handle('proxies:select', (_e, group: string, node: string) => service.selectProxy(group, node))
  ipcMain.handle('proxies:delay', (_e, name: string, url?: string, timeoutMs?: number) =>
    service.testDelay(name, url, timeoutMs)
  )
  ipcMain.handle('proxies:delay-snapshot', () => service.listDelaySnapshot())

  ipcMain.handle('profiles:list', () => service.listProfiles())
  ipcMain.handle('profiles:import-url', (_e, url: string) => service.importFromUrl(url))
  ipcMain.handle('profiles:import-text', (_e, name: string, content: string) => service.importFromText(name, content))
  ipcMain.handle('profiles:remove', (_e, id: string) => service.removeProfile(id))
  ipcMain.handle('profiles:refresh', (_e, id: string) => service.refreshProfile(id))
  ipcMain.handle('profiles:select', (_e, id: string) => service.selectProfile(id))
  ipcMain.handle('profiles:export-uris', (_e, id: string) => service.exportProfileUris(id))
  ipcMain.handle('profiles:refresh-all', () => service.refreshAllUrlProfiles())

  ipcMain.handle('net:check', () => netChecker.run())

  ipcMain.handle('loopback:status', () => loopback.status())
  ipcMain.handle('loopback:enable', () => loopback.enable())
  ipcMain.handle('loopback:disable', () => loopback.disable())

  ipcMain.handle('app:auto-refresh-get', () => getAutoRefresh())
  ipcMain.handle('app:auto-refresh-set', (_e, enabled: boolean) => setAutoRefresh(enabled))

  ipcMain.handle('sub:exclude-get', () => getExcludeKeywords())
  ipcMain.handle('sub:exclude-set', (_e, keywords: string[]) => setExcludeKeywords(Array.isArray(keywords) ? keywords : []))

  ipcMain.handle('system-proxy:get', async (): Promise<SystemProxyState> => systemProxy.read())
  ipcMain.handle('system-proxy:set', async (_e, enabled: boolean): Promise<SystemProxyState> => systemProxy.set(enabled))

  ipcMain.handle('app:auto-start-get', () => getAutoStart())
  ipcMain.handle('app:auto-start-set', (_e, enabled: boolean) => setAutoStart(enabled === true))

  // 渲染端同步界面语言（托盘/原生对话框/自检结果文案跟随）
  ipcMain.handle('app:language-set', (_e, lang: UiLanguage) => setLanguage(lang))

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:data-info', () => ({
    dataDir: app.getPath('userData'),
    portable: isPortableMode(app)
  }))
  ipcMain.handle('app:set-portable', (_e, enabled: boolean) => setPortableEnabled(app, enabled))
  ipcMain.handle('app:get-tun-prereq', () => ({
    wintun: tunPrereq(),
    windows: process.platform === 'win32'
  }))

  // ---------- 应用更新（设置页） ----------
  ipcMain.handle('update:get-state', () => updateManager.getState())
  ipcMain.handle('update:check', () => updateManager.checkNow())
  ipcMain.handle('update:install', () => updateManager.installNow())
  ipcMain.handle('app:update-auto-get', () => updateManager.getState().autoUpdate)
  ipcMain.handle('app:update-auto-set', (_e, enabled: boolean) => setAutoUpdate(enabled === true))
}