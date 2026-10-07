/**
 * 主进程设置持久化（userData/settings.json）。
 *
 * 统一读写入口：进程内缓存 + 单点落盘。
 * 此前 autoRefresh / excludeKeywords / autoUpdate / autoStart 各自维护一对
 * read / write 函数，每次都整体读盘 + 写盘，既重复读盘也存在并发写互相覆盖的隐患；
 * 收敛到本模块后，新增设置项只需一行。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

type Settings = Record<string, unknown>

let cache: Settings | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): Settings {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(filePath(), 'utf-8')) as Settings
  } catch {
    /* 文件缺失或损坏：从空设置开始 */
    cache = {}
  }
  return cache
}

/** 读取设置项；键不存在时返回 fallback（类型校验由调用方负责） */
export function getSetting<T>(key: string, fallback: T): T {
  const v = load()[key]
  return v === undefined ? fallback : (v as T)
}

/** 写入设置项并落盘；返回是否成功落盘（失败时内存值仍生效） */
export function setSetting(key: string, value: unknown): boolean {
  load()[key] = value
  try {
    writeFileSync(filePath(), JSON.stringify(cache, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.warn('[teyvat-arkhon] 保存设置失败:', (e as Error).message)
    return false
  }
}
