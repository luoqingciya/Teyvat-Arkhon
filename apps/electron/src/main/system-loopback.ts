/**
 * Windows UWP 回环豁免：商店应用（Microsoft Store / 邮件 / Xbox 等）默认
 * 不走 127.0.0.1 回环代理，通过 CheckNetIsolation 一键豁免使其可经内核代理。
 * 非 Windows 平台降级为不可用（supported: false）。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LoopbackState } from '@teyvat-arkhon/shared'

const execFileAsync = promisify(execFile)

const CHECKNET = 'CheckNetIsolation.exe'
const PS_LIST_FAMILIES = 'Get-AppxPackage | Select-Object -ExpandProperty PackageFamilyName'

function normalize(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 枚举当前用户已安装的 UWP 应用包族名 */
async function listPackageFamilies(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_LIST_FAMILIES],
    { windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
  )
  return normalize(stdout)
}

/** 执行 CheckNetIsolation，返回合并输出（失败时抛出） */
async function runCheckNet(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(CHECKNET, args, {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024
  })
  return (stdout || stderr || '').trim()
}

/** 解析 -s 输出的已豁免应用数 */
function parseExemptCount(out: string): number {
  const m = out.match(/^\[\s*\d+\]/gm)
  return m ? m.length : 0
}

export interface LoopbackController {
  status(): Promise<LoopbackState>
  enable(): Promise<LoopbackState>
  disable(): Promise<LoopbackState>
}

export function createLoopbackController(): LoopbackController {
  const supported = process.platform === 'win32'

  async function status(): Promise<LoopbackState> {
    if (!supported) return { supported: false, exemptCount: 0 }
    try {
      const out = await runCheckNet(['LoopbackExempt', '-s'])
      return { supported, exemptCount: parseExemptCount(out) }
    } catch (e) {
      return { supported, exemptCount: 0, note: `查询失败: ${(e as Error).message}` }
    }
  }

  async function mutate(flag: '-a' | '-d'): Promise<LoopbackState> {
    if (!supported) return { supported: false, exemptCount: 0, note: '仅 Windows 支持' }
    try {
      const families = await listPackageFamilies()
      if (families.length === 0) {
        return { supported, exemptCount: 0, note: '未检测到可豁免的应用' }
      }
      let done = 0
      let failed = 0
      for (const family of families) {
        try {
          await runCheckNet(['LoopbackExempt', flag, `-n=${family}`])
          done++
        } catch {
          // 系统保留包等无法豁免，忽略单个失败
          failed++
        }
      }
      const state = await status()
      return {
        supported,
        exemptCount: state.exemptCount,
        note: flag === '-a' ? `已豁免 ${done} 个应用（跳过 ${failed}）` : `已撤销 ${done} 个应用的豁免（跳过 ${failed}）`
      }
    } catch (e) {
      return { supported, exemptCount: 0, note: `操作失败: ${(e as Error).message}` }
    }
  }

  return {
    status,
    enable: () => mutate('-a'),
    disable: () => mutate('-d')
  }
}
