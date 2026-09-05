import { BrowserWindow, app, ipcMain } from 'electron'
import type { CoreStatus, SystemProxyState } from '@teyvat-arkhon/shared'
import type { CoreService } from '@teyvat-arkhon/core-bridge'
import type { SystemProxyController } from './system-proxy'
import type { WindowsServiceManager } from './system-service'

/** 订阅主进程错误事件的内容推送到渲染进程 */
export function createIpc(
  service: CoreService,
  systemProxy: SystemProxyController,
  serviceManager: WindowsServiceManager
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

  ipcMain.handle('core:get-status', () => service.status())
  ipcMain.handle('core:start', () => service.start())
  ipcMain.handle('core:stop', () => service.stop())

  ipcMain.handle('core:get-connections', () => service.getConnections())

  ipcMain.handle('core:get-tun', () => service.getTunEnabled())
  ipcMain.handle('core:set-tun', (_e, enabled: boolean) => service.setTunEnabled(enabled))

  ipcMain.handle('service:status', () => serviceManager.status())
  ipcMain.handle('service:install', () => serviceManager.install())
  ipcMain.handle('service:uninstall', () => serviceManager.uninstall())

  ipcMain.handle('proxies:list', () => service.listProxies())
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

  ipcMain.handle('system-proxy:get', async (): Promise<SystemProxyState> => systemProxy.read())
  ipcMain.handle('system-proxy:set', async (_e, enabled: boolean): Promise<SystemProxyState> => systemProxy.set(enabled))

  ipcMain.handle('app:version', () => app.getVersion())
}