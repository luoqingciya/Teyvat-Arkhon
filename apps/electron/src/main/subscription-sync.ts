/**
 * 订阅自动更新：启动时立即刷新全部 URL 订阅，之后按固定间隔定时刷新。
 * 刷新失败保留本地旧档（core-bridge refreshProfile 失败不落盘）。
 */

export interface SubscriptionSyncOptions {
  /** 刷新全部 URL 订阅（返回成功/失败数量） */
  refreshAll: () => Promise<{ ok: number; failed: number }>
  /** 定时刷新间隔 ms（默认 6 小时） */
  intervalMs?: number
}

export interface SubscriptionSync {
  /** 立即刷新一次并启动定时器（幂等） */
  start(): void
  /** 停止定时器（不取消已在进行中的刷新） */
  stop(): void
  get enabled(): boolean
  /** 最近一次刷新结果 */
  lastResult(): { ok: number; failed: number; at: number } | null
}

export function createSubscriptionSync(opts: SubscriptionSyncOptions): SubscriptionSync {
  const intervalMs = opts.intervalMs ?? 6 * 60 * 60 * 1000
  let timer: NodeJS.Timeout | null = null
  let active = false
  let last: { ok: number; failed: number; at: number } | null = null

  async function refreshOnce(): Promise<void> {
    try {
      const r = await opts.refreshAll()
      if (r.ok > 0 || r.failed > 0) last = { ...r, at: Date.now() }
    } catch {
      // 刷新整体失败（极少见）静默保留旧档
    }
  }

  return {
    get enabled(): boolean {
      return active
    },
    lastResult: () => last,
    start(): void {
      if (active) return
      active = true
      // 启动即刷新（不阻塞），随后进入定时节奏
      void refreshOnce()
      timer = setInterval(() => void refreshOnce(), intervalMs)
    },
    stop(): void {
      active = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
