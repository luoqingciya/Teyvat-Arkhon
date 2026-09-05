/**
 * 实时流量监控：轮询内核 /connections，计算瞬时速率并广播到渲染进程。
 * 速率按相邻两次快照的累计字节差 / 间隔计算。
 */

import { BrowserWindow } from 'electron'
import type { TrafficSnapshot } from '@teyvat-arkhon/shared'
import type { CoreService } from '@teyvat-arkhon/core-bridge'

export interface TrafficMonitor {
  start(): void
  stop(): void
}

export function createTrafficMonitor(service: () => CoreService | null): TrafficMonitor {
  let timer: NodeJS.Timeout | null = null
  let prev: { downloadTotal: number; uploadTotal: number } | null = null
  let lastTs = 0

  async function tick(): Promise<void> {
    const svc = service()
    if (!svc || svc.status().state !== 'running') {
      prev = null
      return
    }
    try {
      const { downloadTotal, uploadTotal, connections } = await svc.getConnections()
      const now = Date.now()
      const elapsed = lastTs ? (now - lastTs) / 1000 : 0
      let downloadSpeed = 0
      let uploadSpeed = 0
      if (prev && elapsed > 0) {
        downloadSpeed = Math.max(0, (downloadTotal - prev.downloadTotal) / elapsed)
        uploadSpeed = Math.max(0, (uploadTotal - prev.uploadTotal) / elapsed)
      }
      prev = { downloadTotal, uploadTotal }
      lastTs = now

      const snapshot: TrafficSnapshot = { downloadSpeed, uploadSpeed, downloadTotal, uploadTotal, connections }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('arkhon:traffic', snapshot)
      }
    } catch {
      // 内核数据面暂不可用（如启动/切换瞬间），跳过本轮
    }
  }

  return {
    start(): void {
      if (timer) return
      timer = setInterval(() => void tick(), 1000)
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}