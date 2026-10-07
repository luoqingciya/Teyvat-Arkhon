/**
 * 进程驱动：以 sidecar 方式运行 mihomo 二进制，通过 external-controller RESTful API 通信。
 * 当前唯一驱动（稳定优先）：独立进程天然隔离，升级与排障简单。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { inferNodeType } from '@teyvat-arkhon/shared'
import type {
  ConnectionInfo,
  DelayResult,
  MihomoVersion,
  ProxyItem,
  ProxyMode,
  RuleInfo
} from '@teyvat-arkhon/shared'
import { RestClient, type MihomoConnections, type MihomoProxyMap, type MihomoRules } from './rest-client'
import type { CoreDriver } from './driver'

export interface ProcessDriverOptions {
  /** mihomo 可执行文件绝对路径 */
  binaryPath: string
  /** mihomo -d 工作目录（存放 config.yaml） */
  workingDir: string
  /** REST 外控地址，如 127.0.0.1:9090 */
  externalController: string
  /** 外控密钥（可为空） */
  secret: string
  /** 子进程意外退出回调 */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  /** 内核 stdout/stderr 日志回调（按时间窗口批量合并，单次携带多行） */
  onLogs?: (lines: string[]) => void
  /** 内核日志环形缓冲上限 */
  logLimit?: number
  /** fetch 注入（测试用） */
  fetchImpl?: typeof fetch
  /** 就绪等待超时 ms */
  startupTimeoutMs?: number
}

const READY_POLL_INTERVAL = 250
/** 日志批量推送窗口：窗口内到达的行合并为一次回调，降低 IPC 频次 */
const LOG_FLUSH_INTERVAL_MS = 100
/** 待推送日志达到该条数立即冲刷，避免高吞吐日志下的推送延迟累积 */
const LOG_FLUSH_MAX_PENDING = 200

export class ProcessCoreDriver implements CoreDriver {
  readonly kind = 'process' as const

  private readonly rest: RestClient
  private child: ChildProcess | null = null
  private exited = false
  private readonly startupTimeoutMs: number
  private readonly logs: string[] = []
  private readonly logLimit: number
  /** 待批量推送的日志（时间窗口内累积） */
  private readonly pendingLogs: string[] = []
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: ProcessDriverOptions) {
    this.rest = new RestClient({
      controller: opts.externalController,
      secret: opts.secret,
      fetchImpl: opts.fetchImpl
    })
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 10_000
    this.logLimit = opts.logLimit ?? 500
  }

  get running(): boolean {
    return this.child !== null && !this.exited
  }

  private pushLog(chunk: Buffer | string): void {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : chunk
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      this.logs.push(trimmed)
      if (this.logs.length > this.logLimit) this.logs.shift()
      this.pendingLogs.push(trimmed)
    }
    if (!this.pendingLogs.length) return
    // 高吞吐日志立即冲刷，避免推送延迟累积
    if (this.pendingLogs.length >= LOG_FLUSH_MAX_PENDING) {
      this.flushLogs()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushLogs(), LOG_FLUSH_INTERVAL_MS)
      this.flushTimer.unref?.()
    }
  }

  /** 冲刷待推送日志：合并为一次回调（stop/close 时也会调用，避免尾部日志丢失） */
  private flushLogs(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.pendingLogs.length) return
    const batch = this.pendingLogs.splice(0, this.pendingLogs.length)
    this.opts.onLogs?.(batch)
  }

  getLogs(): string[] {
    return [...this.logs]
  }

  async start(): Promise<void> {
    if (this.running) return

    const binary = this.opts.binaryPath
    this.exited = false
    try {
      this.child = spawn(binary, ['-d', this.opts.workingDir], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child.stdout?.on('data', (d: Buffer) => this.pushLog(d))
      this.child.stderr?.on('data', (d: Buffer) => this.pushLog(d))
    } catch (e) {
      throw new Error(
        `无法启动 mihomo（${binary}）。请先运行 pnpm core:download 下载内核，` +
          `或检查路径是否正确。原始错误: ${(e as Error).message}`
      )
    }

    this.child.on('exit', (code, signal) => {
      this.child = null
      this.exited = true
      this.opts.onExit?.(code, signal)
    })
    // 启动进程立即失败（如 ENOENT）时给出明确错误
    this.child.on('error', (err) => {
      this.child?.kill()
      this.child = null
      this.exited = true
      throw err
    })

    await this.waitForReady()
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs
    while (Date.now() < deadline) {
      if (!this.running) throw new Error('mihomo 进程启动后立即退出')
      try {
        await this.rest.get('/version')
        return
      } catch {
        await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL))
      }
    }
    throw new Error(`mihomo 在 ${this.startupTimeoutMs}ms 内未就绪（检查 external-controller 配置）`)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })
    child.kill()
    // Windows 下 SIGTERM 语义弱，兜底强制结束
    setTimeout(() => {
      if (this.running) child.kill('SIGKILL')
    }, 3000).unref()
    await exited
    this.exited = true
    // 冲刷尾部日志（子进程退出前最后几行可能仍在待推送缓冲中）
    this.flushLogs()
  }

  async reload(configPath: string): Promise<void> {
    await this.rest.patch('/configs', { path: configPath })
  }

  async setMode(mode: ProxyMode): Promise<void> {
    await this.rest.patch('/configs', { mode })
  }

  async getMode(): Promise<ProxyMode | undefined> {
    const cfg = await this.rest.get<{ mode?: string }>('/configs')
    const m = cfg.mode
    return m === 'rule' || m === 'global' || m === 'direct' ? m : undefined
  }

  async getVersion(): Promise<MihomoVersion> {
    const v = await this.rest.get<MihomoVersion & { meta?: boolean }>('/version')
    return { version: v.version, meta: v.meta ?? false }
  }

  async getProxies(): Promise<ProxyItem[]> {
    const map = await this.rest.get<MihomoProxyMap>('/proxies')
    return Object.values(map.proxies).map((p) => ({
      name: p.name,
      type: p.type,
      nodeType: inferNodeType(p.type),
      now: p.now,
      alive: p.alive,
      history: p.history,
      all: p.all,
      bot: p.bot
    }))
  }

  /** 当前生效的路由规则（rule 模式；global/direct 模式下内核返回空洞规则） */
  async getRules(): Promise<RuleInfo[]> {
    const res = await this.rest.get<MihomoRules>('/rules')
    return (res.rules ?? []).map((r) => ({
      type: r.type,
      payload: r.payload,
      proxy: r.proxy,
      hits: r.hits ?? 0
    }))
  }

  async selectProxy(groupName: string, nodeName: string): Promise<void> {
    await this.rest.put(`/proxies/${encodeURIComponent(groupName)}`, { name: nodeName })
  }

  async testDelay(name: string, url = 'https://www.gstatic.com/generate_204', timeoutMs = 5000): Promise<DelayResult> {
    const q = new URLSearchParams({ timeout: String(timeoutMs), url })
    let groupError: unknown
    try {
      const res = await this.rest.get<{ delay?: number }>(`/proxies/${encodeURIComponent(name)}/delay?${q}`)
      if (typeof res.delay === 'number') return { node: name, delay: res.delay }
      throw new Error('未返回延迟数据')
    } catch (e) {
      groupError = e
    }
    try {
      // 策略组使用 group 端点
      const groupRes = await this.rest.get<{ delay?: number }>(`/group/${encodeURIComponent(name)}/delay?${q}`)
      if (typeof groupRes.delay === 'number') return { node: name, delay: groupRes.delay }
    } catch {
      /* 节点与组端点均失败 */
    }
    return { node: name, delay: -1, error: groupError instanceof Error ? groupError.message : String(groupError) }
  }

  /** 全部节点最近一次延迟测试快照（读取内核 /delay/latest 缓存，不触发测速） */
  async listDelaySnapshot(): Promise<Record<string, number | null>> {
    try {
      const res = await this.rest.get<{ proxies: Record<string, { delay?: number | null }> }>('/delay/latest')
      const out: Record<string, number | null> = {}
      for (const [name, entry] of Object.entries(res.proxies ?? {})) {
        out[name] = typeof entry.delay === 'number' && entry.delay > 0 ? entry.delay : null
      }
      return out
    } catch {
      // 定制端点缺失/内核未启用时降级为空快照，不阻塞页面
      return {}
    }
  }

  async getConnections(): Promise<{ downloadTotal: number; uploadTotal: number; connections: ConnectionInfo[] }> {
    const res = await this.rest.get<MihomoConnections>('/connections')
    return {
      downloadTotal: res.downloadTotal ?? 0,
      uploadTotal: res.uploadTotal ?? 0,
      connections: (res.connections ?? []).map((c) => ({
        id: c.id,
        host: c.metadata.host ?? '',
        type: c.metadata.type ?? '',
        network: c.metadata.network ?? '',
        process: c.metadata.process,
        download: c.download,
        upload: c.upload,
        start: c.start,
        chains: c.chains ?? [],
        rule: c.rule ?? '',
        rulePayload: c.rulePayload
      }))
    }
  }

  async closeConnection(id: string): Promise<void> {
    await this.rest.delete(`/connections/${encodeURIComponent(id)}`)
  }

  async closeAllConnections(): Promise<void> {
    await this.rest.delete('/connections')
  }

  async close(): Promise<void> {
    await this.stop()
  }
}