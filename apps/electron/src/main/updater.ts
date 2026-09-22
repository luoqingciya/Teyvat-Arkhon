/**
 * 应用更新管理：基于 electron-updater + GitHub Releases。
 * - 设置页可手动检查、查看状态、立即重启安装；
 * - 每次状态变化广播到渲染进程（arkhon:update）。
 * 仅打包（非 dev）且未设置 TEVVAT_ARKHON_DISABLE_UPDATE 时启用。
 */

import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@teyvat-arkhon/shared'

export interface UpdateManager {
  /** 当前更新状态快照 */
  getState(): UpdateState
  /** 手动检查更新 */
  checkNow(): Promise<UpdateState>
  /** 立即重启并安装（需已有下载完成的更新） */
  installNow(): void
  /** 自动检查开关 */
  setAutoEnabled(enabled: boolean): boolean
}

export interface UpdateManagerOptions {
  /** 自动检查开关（初始值，主进程持久化配合） */
  autoEnabled: boolean
  /** 状态变化广播（主进程向渲染窗口推送） */
  onBroadcast?: (state: UpdateState) => void
}

const UPDATE_CHANNEL = 'arkhon:update'

/** 把 electron-updater 的原始报错映射成用户可读的提示（404/网络/认证等常见场景） */
function friendlyUpdateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Cannot find latest\.yml|latest-linux\.yml|404/i.test(msg) && /404/.test(msg)) {
    return '发布尚未完成或版本已下线，请稍后再试'
  }
  if (/release.*not found|404/i.test(msg) && !/401|403/.test(msg)) {
    return '未找到可下载的版本（发布可能尚未完成），请稍后重试'
  }
  if (/401|403|token|authentication|unauthorized/i.test(msg)) {
    return '更新服务器鉴权失败，请确认发布可用后重试'
  }
  if (/getaddrinfo|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|ERR_INTERNET|network/i.test(msg)) {
    return '无法连接更新服务器，请检查网络后重试'
  }
  return msg
}

export function createUpdateManager(opts: UpdateManagerOptions): UpdateManager {
  let autoEnabled = opts.autoEnabled
  let state: UpdateState['state'] = 'idle'
  let updateVersion: string | undefined
  let lastError = ''

  const send = (): void => {
    const snapshot = snapshotState()
    opts.onBroadcast?.(snapshot)
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(UPDATE_CHANNEL, snapshot)
    }
  }

  const snapshotState = (): UpdateState => ({
    state: state === 'idle' ? 'idle' : state,
    currentVersion: app.getVersion(),
    autoUpdate: autoEnabled,
    version: updateVersion,
    message: lastError || undefined
  })

  // ---- electron-updater 事件 ----
  if (app.isPackaged && process.env['TEVVAT_ARKHON_DISABLE_UPDATE'] !== '1') {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      state = 'checking'
      lastError = ''
      send()
    })
    autoUpdater.on('update-available', (info) => {
      state = 'available'
      updateVersion = info.version
      send()
      // 自动下载由 autoDownload=true 接管；下载完成走 update-downloaded
    })
    autoUpdater.on('update-not-available', () => {
      state = 'not-available'
      send()
    })
    autoUpdater.on('update-downloaded', (info) => {
      state = 'downloaded'
      updateVersion = info.version
      send()
      try {
        dialog
          .showMessageBox({
            type: 'info',
            title: 'Teyvat Arkhon',
            message: `新版本 ${info.version} 已就绪`,
            detail: '可在「设置 → 更新」中安装。是否立即重启应用完成更新？',
            buttons: ['稍后', '立即重启'],
            defaultId: 1,
            cancelId: 0
          })
          .then(({ response }) => {
            if (response === 1) autoUpdater.quitAndInstall(false, true)
          })
      } catch {
        /* 对话框失败时静默，设置页仍可手动安装 */
      }
    })
    autoUpdater.on('error', (err) => {
      state = 'error'
      lastError = friendlyUpdateError(err)
      console.warn('[teyvat-arkhon] 更新检查失败:', err instanceof Error ? err.message : err)
      send()
    })
  }

  const enabled = (): boolean => app.isPackaged && process.env['TEVVAT_ARKHON_DISABLE_UPDATE'] !== '1'

  const manager: UpdateManager = {
    getState(): UpdateState {
      if (!enabled()) {
        return {
          state: process.env['TEVVAT_ARKHON_DISABLE_UPDATE'] === '1' ? 'disabled' : 'disabled',
          currentVersion: app.getVersion(),
          autoUpdate: autoEnabled,
          message: !app.isPackaged ? '开发环境不检查更新' : '自动更新已被环境变量禁用'
        }
      }
      return snapshotState()
    },

    async checkNow(): Promise<UpdateState> {
      if (!enabled()) return manager.getState()
      try {
        await autoUpdater.checkForUpdates()
      } catch {
        /* 错误由 error 事件广播 */
      }
      return manager.getState()
    },

    installNow(): void {
      if (enabled() && state === 'downloaded') {
        autoUpdater.quitAndInstall(false, true)
      }
    },

    setAutoEnabled(enabled): boolean {
      autoEnabled = enabled
      send()
      return autoEnabled
    }
  }

  return manager
}