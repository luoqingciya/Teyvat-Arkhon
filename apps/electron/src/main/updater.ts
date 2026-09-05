/**
 * 自动更新：基于 electron-updater + GitHub Releases。
 * 仅在打包（非 dev）且未设置 TEVVAT_ARKHON_DISABLE_UPDATE 时启用。
 */

import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

let checkedOnce = false

export function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('[teyvat-arkhon] 开发环境跳过自动更新')
    return
  }
  if (process.env['TEVVAT_ARKHON_DISABLE_UPDATE'] === '1') {
    console.log('[teyvat-arkhon] 已通过环境变量禁用自动更新')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    try {
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Teyvat Arkhon',
          message: `新版本 ${info.version} 已就绪`,
          detail: '将在退出时自动安装。是否立即重启应用完成更新？',
          buttons: ['稍后', '立即重启'],
          defaultId: 1,
          cancelId: 0
        })
        .then(({ response }) => {
          if (response === 1) {
            void autoUpdater.quitAndInstall(false, true)
          }
        })
    } catch {
      /* 对话框失败时静默，下次启动再检查 */
    }
  })
  autoUpdater.on('error', (err) => {
    console.warn('[teyvat-arkhon] 自动更新检查失败:', err?.message ?? err)
  })

  // 延迟到窗口准备好后检查一次
  setTimeout(() => {
    if (checkedOnce) return
    checkedOnce = true
    void autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)
}