/**
 * 实时流量监控：轮询内核 /connections，计算瞬时速率并广播到渲染进程。
 * 速率按相邻两次快照的累计字节差 / 间隔计算。
 *
 * 两条通道分离：
 *  - `arkhon:traffic`：轻量快照（速率/累计/连接数），每秒推送；
 *  - `arkhon:connections`：连接明细（体积大），仅在渲染端订阅后推送（引用计数），
 *    避免每秒向所有窗口结构化克隆整个连接数组。
 *
 * 无可见窗口时（托盘常驻/最小化）降频轮询且不推送，减少空转开销。
 */

import { BrowserWindow } from 'electron'
import { EVT } from '@teyvat-arkhon/shared'
import type { ConnectionInfo, TrafficSnapshot } from '@teyvat-arkhon/shared'
import type { CoreService } from '@teyvat-arkhon/core-bridge'

export interface TrafficMonitor {
  start(): void
  stop(): void
  /** 订阅连接明细推送（引用计数）；返回当前缓存的连接快照供首帧立即渲染 */
  subscribeConnections(): ConnectionInfo[]
  /** 退订连接明细推送 */
  unsubscribeConnections(): void
}

/** 窗口可见时的轮询间隔 */
const VISIBLE_INTERVAL_MS = 1_000
/** 无可见窗口时的轮询间隔（仅维持速率计算连续性，不推送） */
const HIDDEN_INTERVAL_MS = 3_000

export function createTrafficMonitor(service: () => CoreService | null): TrafficMonitor {
  let timer: NodeJS.Timeout | null = null
  let stopped = true
  let prev: { downloadTotal: number; uploadTotal: number } | null = null
  let lastTs = 0
  /** 连接明细订阅数（>0 时才推送明细） */
  let subscribers = 0
  /** 最近一次连接明细（供订阅瞬间立即回填，避免等待下一个 tick） */
  let lastConnections: ConnectionInfo[] = []

  function anyWindowVisible(): boolean {
    return BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isMinimized())
  }

  function broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }

  function schedule(ms: number): void {
    if (stopped) return
    timer = setTimeout(() => void tick(), ms)
    timer.unref?.()
  }

  async function tick(): Promise<void> {
    const visible = anyWindowVisible()
    const svc = service()

    // 内核未运行：清空基线（避免下次启动时算出跨停机区间的虚假速率）
    if (!svc || svc.status().state !== 'running') {
      prev = null
      lastTs = 0
      lastConnections = []
      if (visible && subscribers > 0) broadcast(EVT.connections, [])
      schedule(visible ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS)
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
      lastConnections = connections

      // 无可见窗口时无人消费，跳过推送（仍保持基线更新，保证速率连续）
      if (visible) {
        const snapshot: TrafficSnapshot = {
          downloadSpeed,
          uploadSpeed,
          downloadTotal,
          uploadTotal,
          connectionCount: connections.length
        }
        broadcast(EVT.traffic, snapshot)
        if (subscribers > 0) broadcast(EVT.connections, connections)
      }
    } catch {
      // 内核数据面暂不可用（如启动/切换瞬间），跳过本轮
    }
    schedule(visible ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS)
  }

  return {
    start(): void {
      if (!stopped) return
      stopped = false
      void tick()
    },
    stop(): void {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      subscribers = 0
      prev = null
      lastTs = 0
      lastConnections = []
    },
    subscribeConnections(): ConnectionInfo[] {
      subscribers++
      return lastConnections
    },
    unsubscribeConnections(): void {
      subscribers = Math.max(0, subscribers - 1)
    }
  }
}
