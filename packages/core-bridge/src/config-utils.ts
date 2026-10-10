/**
 * 配置层的低层工具：类型判定、数值/字符串收敛、默认常量。
 * 从 config-manager 抽出，供 config-manager 与 active-config 共用，避免二者相互依赖。
 */

import { promises as fs } from 'node:fs'

/** 未显式配置 external-controller 时的回退地址 */
export const DEFAULT_CONTROLLER = '127.0.0.1:9090'

/** 应用写入的默认 TUN 段（整行文本；关闭时按该行精确移除，用户自定义段不受影响） */
export const TUN_DEFAULT =
  'tun: {enable: true, stack: mixed, mtu: 1500, auto-route: true, auto-detect-interface: true, strict-route: false, device: "Teyvat TUN"}'

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function numberVal(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export function stringVal(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
