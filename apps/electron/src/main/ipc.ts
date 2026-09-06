import { BrowserWindow, app, ipcMain } from 'electron'
import type { CoreStatus, ProxyMode, SystemProxyState } from '@teyvat-arkhon/shared'
import type { CoreService } from '@teyvat-arkhon/core-bridge'
import type { SystemProxyController } from './system-proxy'
import type { WindowsServiceManager } from './system-service'
import type { NetChecker } from './net-check'
import type { LoopbackController } from './system-loopback'
import { setPortableEnabled, isPortableMode } from './paths'

/** 订阅主进程错误事件的内容推送到渲染进程 */
export function createIpc(
  service: CoreService,
  systemProxy: SystemProxyController,
  serviceManager: WindowsServiceManager,
  tunPrereq: () => boolean,
  netChecker: NetChecker,
  loopback: LoopbackController,
  getAutoRefresh: () => boolean,
  setAutoRefresh: (enabled: boolean) => void,
  getExcludeKeywords: () => string[],
  setExcludeKeywords: (keywords: string[]) => void
): void {
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
  service.on('core-log', (line: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('arkhon:log', line)
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

  ipcMain.handle('config:get-active', () => service.getActiveConfig())
  ipcMain.handle('config:save-active', (_e, content: string) => service.saveActiveConfig(content))

  ipcMain.handle('core:get-tun', () => service.getTunEnabled())
  ipcMain.handle('core:set-tun', (_e, enabled: boolean) => service.setTunEnabled(enabled))

  ipcMain.handle('service:status', () => serviceManager.status())
  ipcMain.handle('service:install', () => serviceManager.install())
  ipcMain.handle('service:uninstall', () => serviceManager.uninstall())

  ipcMain.handle('proxies:list', () => service.listProxies())
  ipcMain.handle('rules:list', () => service.listRules())
  ipcMain.handle('proxies:select', (_e, group: string, node: string) => service.selectProxy(group, node))
  ipcMain.handle('proxies:delay', (_e, name: string, url?: string, timeoutMs?: number) =>
    service.testDelay(name, url, timeoutMs)
  )

  ipcMain.handle('profiles:list', () => service.listProfiles())
  ipcMain.handle('profiles:import-url', (_e, url: string) => service.importFromUrl(url))
  ipcMain.handle('profiles:import-text', (_e, name: string, content: string) => service.importFromText(name, content))
  ipcMain.handle('profiles:remove', (_e, id: string) => service.removeProfile(id))
  ipcMain.handle('profiles:refresh', (_e, id: string) => service.refreshProfile(id))
  ipcMain.handle('profiles:select', (_e, id: string) => service.selectProfile(id))
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
}