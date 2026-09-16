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
import { cpSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
 * 一次性回迁：v1.3.4 曾把安装版数据迁到系统 userData。现数据固定回安装目录 data/，
 * 若安装目录无真实订阅而系统 userData 有，则把订阅与配置复制回安装目录。
 * 幂等：安装目录已有真实订阅（profiles/index.json 非空）时不动。
 */
function recoverUserDataToDataDir(appHandle: App): void {
  if (!appHandle.isPackaged) return
  const dataDir = join(appRootDir(appHandle), PORTABLE_DATA_DIR)
  try {
    const dataIdx = join(dataDir, 'profiles', 'index.json')
    if (existsSync(dataIdx) && statSync(dataIdx).size > 2) return
  } catch {
    return
  }
  // 系统默认 userData（setPath 之前的原始位置，v1.3.4 迁移目标）
  const legacy = join(appHandle.getPath('appData'), appHandle.getName())
  try {
    const legacyIdx = join(legacy, 'profiles', 'index.json')
    if (!existsSync(legacyIdx) || statSync(legacyIdx).size <= 2) return
  } catch {
    return
  }
  try {
    mkdirSync(join(dataDir, 'profiles'), { recursive: true })
    if (existsSync(join(legacy, 'profiles'))) {
      cpSync(join(legacy, 'profiles'), join(dataDir, 'profiles'), { recursive: true, force: true })
    }
    mkdirSync(join(dataDir, 'config'), { recursive: true })
    if (existsSync(join(legacy, 'config'))) {
      cpSync(join(legacy, 'config'), join(dataDir, 'config'), { recursive: true, force: true })
    }
    console.log('[teyvat-arkhon] 已从系统目录恢复订阅配置到安装目录 %s', dataDir)
  } catch (e) {
    console.warn('[teyvat-arkhon] 从系统目录恢复订阅配置失败:', (e as Error).message)
  }
}

/**
 * 计算并设置运行数据目录（须在 app ready 之前调用一次）。
 * 便携模式下：数据目录 = 运行目录/data，并把 XDG_CONFIG_HOME 指过去
 * （内嵌 mihomo 与主进程同进程，可读到该 env，geo/wintun 跟随本地）。
 */
export function bootstrapDataDir(appHandle: App): { dataDir: string; portable: boolean } {
  const portable = isPortableMode(appHandle)
  const dataDir = portable ? join(appRootDir(appHandle), PORTABLE_DATA_DIR) : appHandle.getPath('userData')
  if (portable) {
    mkdirSync(dataDir, { recursive: true })
    process.env['XDG_CONFIG_HOME'] = dataDir
  }
  appHandle.setPath('userData', dataDir)
  // 打包版启动：把 v1.3.4 误迁到系统 userData 的真实订阅带回安装目录 data/
  if (portable) recoverUserDataToDataDir(appHandle)
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