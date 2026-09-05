/**
 * 进程驱动：以 sidecar 方式运行 mihomo 二进制，通过 external-controller RESTful API 通信。
 * 当前唯一驱动（稳定优先）：独立进程天然隔离，升级与排障简单。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type {
  ConnectionInfo,
  DelayResult,
  MihomoVersion,
  ProxyItem,
  ProxyMode
} from '@teyvat-arkhon/shared'
import { RestClient, type MihomoConnections, type MihomoProxyEntry, type MihomoProxyMap } from './rest-client'
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
  /** 内核 stdout/stderr 每行日志回调 */
  onLog?: (line: string) => void
  /** 内核日志环形缓冲上限 */
  logLimit?: number
  /** fetch 注入（测试用） */
  fetchImpl?: typeof fetch
  /** 就绪等待超时 ms */
  startupTimeoutMs?: number
}

const READY_POLL_INTERVAL = 250

export class ProcessCoreDriver implements CoreDriver {
  readonly kind = 'process' as const

  private readonly rest: RestClient
  private child: ChildProcess | null = null
  private exited = false
  private readonly startupTimeoutMs: number
  private readonly logs: string[] = []
  private readonly logLimit: number

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
      this.opts.onLog?.(trimmed)
    }
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
      nodeType: inferNodeType(p),
      now: p.now,
      alive: p.alive,
      history: p.history,
      all: p.all,
      bot: p.bot
    }))
  }

  async selectProxy(groupName: string, nodeName: string): Promise<void> {
    await this.rest.put(`/proxies/${encodeURIComponent(groupName)}`, { name: nodeName })
  }

  async testDelay(name: string, url = 'https://www.gstatic.com/generate_204', timeoutMs = 5000): Promise<DelayResult> {
    const q = new URLSearchParams({ timeout: String(timeoutMs), url })
    try {
      const res = await this.rest.get<{ delay?: number }>(`/proxies/${encodeURIComponent(name)}/delay?${q}`)
      if (typeof res.delay === 'number') return { node: name, delay: res.delay }
      throw new Error('未返回延迟数据')
    } catch (e) {
      // 策略组使用 group 端点
      const groupRes = await this.rest.get<{ delay?: number }>(
        `/group/${encodeURIComponent(name)}/delay?${q}`
      )
      if (typeof groupRes.delay === 'number') return { node: name, delay: groupRes.delay }
      return { node: name, delay: -1, error: (e as Error).message }
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

/**
 * mihomo REST /proxies 列表响应不返回 nodeType 字段（实测 v1.19.30），
 * 按 type 推断其语义（数值与 mihomo 内核 NodeType 定义一致）：
 *   Selector=2 / URLTest=1 / Fallback=3 / LoadBalance=4 / Relay=5，其余为单节点=0。
 */
function inferNodeType(p: MihomoProxyEntry): number {
  switch (p.type) {
    case 'URLTest':
      return 1
    case 'Selector':
      return 2
    case 'Fallback':
      return 3
    case 'LoadBalance':
      return 4
    case 'Relay':
      return 5
    default:
      return 0
  }
}