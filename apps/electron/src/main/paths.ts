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
 *   3. 默认策略：打包版若 exe 所在目录可写（解压的免安装版），自动数据跟随 exe 同级；
 *      安装版（如 Program Files 等不可写目录）或开发期回退系统用户目录。
 */

import { type App } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PORTABLE_MARKER = 'portable.txt'
export const PORTABLE_DATA_DIR = 'data'

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

export function isPortableMode(appHandle: App, env = process.env): boolean {
  if (env['TEVVAT_ARKHON_PORTABLE'] === '1') return true
  try {
    if (existsSync(join(appRootDir(appHandle), PORTABLE_MARKER))) return true
  } catch {
    /* 目录不可达则跳过标记判断 */
  }
  // 默认策略：仅打包版按"可写则跟随运行目录"处理；开发期固定在系统用户目录
  if (!appHandle.isPackaged) return false
  return dirWritable(appRootDir(appHandle))
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