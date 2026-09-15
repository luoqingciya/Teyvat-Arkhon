/**
 * 运行数据目录策略。
 *
 * 默认（安装版 / 开发期）：使用系统 standard userData 目录（Windows: %APPDATA%\<app>，macOS: ~/Library/Application Support，Linux: ~/.config/<app>）。
 *
 * 便携模式：所有运行时数据（订阅档案、工作配置、geo/wintun 播种）落在
 * 应用运行目录的 data/ 下，实现"数据跟随运行目录"的绿色版体验。
 * 判定（优先级）：
 *   1. 环境变量 TEVVAT_ARKHON_PORTABLE=1（强制便携）
 *   2. 运行目录下存在 portable.txt（强制便携）
 *   3. NSIS 安装版排除：打包版若检测到安装注册表/卸载程序痕迹，判定为安装版，
 *      固定使用系统用户目录（安装目录可写但更新卸载时会整目录删除，便携会丢数据）
 *   4. 默认策略：打包版若 exe 所在目录可写（解压的免安装版），自动数据跟随 exe 同级；
 *      其余（不可写目录）或开发期回退系统用户目录。
 */

import { type App } from 'electron'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PORTABLE_MARKER = 'portable.txt'
export const PORTABLE_DATA_DIR = 'data'
/** NSIS 卸载注册表键名（electron-builder 默认取 appId，写入 HKCU 或 HKLM） */
const APP_ID = 'com.teyvat.arkhon'

/** 应用可执行/运行根目录（打包为 exe 同级，开发期为仓库 apps/electron） */
export function appRootDir(appHandle: App): string {
  if (appHandle.isPackaged) return dirname(appHandle.getAppPath())
  return appHandle.getAppPath()
}

/** 目录可写探测：能创建并删除临时文件视为可写 */
function dirWritable(dir: string): boolean {
  const probe = join(dir, `.wprobe-${process.pid}`)
  try {
    writeFileSync(probe, '1')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Windows NSIS 安装版探测（区分安装版与手动解压的 zip 便携包）：
 *  - 注册表卸载键存在（HKCU 或 HKLM）
 *  - 或安装目录存在 Uninstall <产品名>.exe
 * 安装版即使安装目录可写也禁用"自动便携"，避免自动更新卸载时整目录删除丢数据。
 */
export function isNsisWindowsInstall(appHandle: App): boolean {
  if (process.platform !== 'win32' || !appHandle.isPackaged) return false
  try {
    const cache = execFileSync('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`], {
      stdio: 'ignore',
      windowsHide: true
    })
    if (cache.length > 0) return true
  } catch {
    /* 键不存在 */
  }
  try {
    execFileSync('reg', ['query', `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`], {
      stdio: 'ignore',
      windowsHide: true
    })
    return true
  } catch {
    /* 键不存在 */
  }
  // 卸载程序痕迹兜底（oneClick: false 会产生 "Uninstall <产品名>.exe"）
  try {
    const root = appRootDir(appHandle)
    return readdirSync(root).some((f) => /^uninstall.*\.exe$/i.test(f))
  } catch {
    return false
  }
}

export function isPortableMode(appHandle: App, env = process.env): boolean {
  if (env['TEVVAT_ARKHON_PORTABLE'] === '1') return true
  try {
    if (existsSync(join(appRootDir(appHandle), PORTABLE_MARKER))) return true
  } catch {
    /* 目录不可达则跳过标记判断 */
  }
  // 安装版不走"目录可写自动便携"（更新卸载会删除安装目录）
  if (isNsisWindowsInstall(appHandle)) return false
  // 默认策略：仅打包版按"可写则跟随运行目录"处理；开发期固定在系统用户目录
  if (!appHandle.isPackaged) return false
  return dirWritable(appRootDir(appHandle))
}

/**
 * 未设置 userData 前系统默认的数据目录（Windows: %APPDATA%\<产品名>）。
 * 便携模式下 app.getPath('userData') 已被重定向，迁移目标需取此原始路径。
 */
export function defaultUserDataDir(appHandle: App): string {
  return join(appHandle.getPath('appData'), appHandle.getName())
}

/**
 * 便携数据迁移（退出时调用）：旧版安装版曾被误判为便携、数据在运行目录 data/ 下，
 * 修复判定后新版本使用系统 userData。退出前把 data/ 迁到系统目录，
 * 使自动更新（NSIS 卸载安装目录）与正常升级都不再丢失配置。
 * 触发条件：NSIS 安装版 + 运行目录存在 data/（即曾被误判便携）+ 非显式便携标记。
 * 安全策略：目标目录不存在或为空才迁移；成功后删除源目录。
 */
export function migratePortableData(appHandle: App): { migrated: boolean; note: string } {
  if (process.platform !== 'win32' || !appHandle.isPackaged) {
    return { migrated: false, note: '非 Windows 打包运行，无需迁移' }
  }
  if (!isNsisWindowsInstall(appHandle)) {
    return { migrated: false, note: '非 NSIS 安装版，无需迁移' }
  }
  const root = appRootDir(appHandle)
  // 显式便携（portable.txt）尊重用户意图，不迁移
  try {
    if (existsSync(join(root, PORTABLE_MARKER))) {
      return { migrated: false, note: '显式便携模式，尊重用户设置不迁移' }
    }
  } catch {
    /* 目录不可达按无标记处理 */
  }
  const src = join(root, PORTABLE_DATA_DIR)
  if (!existsSync(src)) return { migrated: false, note: '无便携数据目录' }
  const dest = defaultUserDataDir(appHandle)
  try {
    const destEmpty = !existsSync(dest) || readdirSync(dest).length === 0
    if (!destEmpty) return { migrated: false, note: '系统数据目录已有内容，跳过迁移以保护现有数据' }
    mkdirSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
    return { migrated: true, note: `便携数据已迁移至 ${dest}` }
  } catch (e) {
    return { migrated: false, note: `迁移失败（保留原目录，下次退出重试）: ${(e as Error).message}` }
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