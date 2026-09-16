/**
 * 运行数据目录策略。
 *
 * 数据固定跟随运行目录（便携模式）：所有运行时数据（订阅档案、工作配置、
 * geo/wintun 播种）落在应用运行目录的 data/ 下，实现"数据跟随应用"的绿色版体验。
 * 判定（优先级）：
 *   1. 环境变量 TEVVAT_ARKHON_PORTABLE=1（强制便携）
 *   2. 运行目录下存在 portable.txt（强制便携）
 *   3. 打包版一律便携（数据在安装目录 data/；NSIS 安装器已配置更新/卸载时
 *      保留 data 目录，见 build/installer.nsh customRemoveFiles）
 *   4. 开发期固定使用系统标准 userData 目录
 */

import { type App } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PORTABLE_MARKER = 'portable.txt'
export const PORTABLE_DATA_DIR = 'data'

/**
 * 应用可执行/运行根目录：
 *  - 打包后 = exe 所在目录（安装根目录）。
 *    注意：app.getAppPath() 打包后指向 resources/app.asar，dirname 会取到 resources，
 *    导致便携判定/数据目录整体错位（历史 bug），必须用 process.execPath。
 *  - 开发期 = 仓库 apps/electron。
 */
export function appRootDir(appHandle: App): string {
  if (appHandle.isPackaged) return dirname(process.execPath)
  return appHandle.getAppPath()
}

export function isPortableMode(appHandle: App, env = process.env): boolean {
  if (env['TEVVAT_ARKHON_PORTABLE'] === '1') return true
  try {
    if (existsSync(join(appRootDir(appHandle), PORTABLE_MARKER))) return true
  } catch {
    /* 目录不可达则跳过标记判断 */
  }
  // 打包版一律便携：数据固定在安装目录 data/（NSIS 更新/卸载已配置保留该目录）
  if (!appHandle.isPackaged) return false
  return true
}

/**
 * 计算并设置运行数据目录（须在 app ready 之前调用一次）。
 * 数据固定跟随应用：打包版 userData = 安装目录 data/，开发期用系统 userData。
 */
export function bootstrapDataDir(appHandle: App): { dataDir: string; portable: boolean } {
  const portable = isPortableMode(appHandle)
  const dataDir = portable ? join(appRootDir(appHandle), PORTABLE_DATA_DIR) : appHandle.getPath('userData')
  if (portable) {
    mkdirSync(dataDir, { recursive: true })
    process.env['XDG_CONFIG_HOME'] = dataDir
  }
  appHandle.setPath('userData', dataDir)
  return { dataDir, portable }
}

/** 便携模式开关：写/删运行目录下的标记文件（重启后生效） */
export function setPortableEnabled(appHandle: App, enabled: boolean): { portable: boolean; note: string } {
  const marker = join(appRootDir(appHandle), PORTABLE_MARKER)
  if (enabled) {
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, '1\n', 'utf-8')
    return { portable: true, note: '已启用便携模式，重启应用后生效' }
  }
  try {
    unlinkSync(marker)
  } catch {
    /* 标记不存在则忽略 */
  }
  return { portable: false, note: '已停用便携模式，重启应用后生效' }
}