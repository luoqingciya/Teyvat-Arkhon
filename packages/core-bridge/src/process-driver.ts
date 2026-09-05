/**
 * 进程驱动：以 sidecar 方式运行 mihomo 二进制，通过 external-controller RESTful API 通信。
 * 用作开发环境 / 无原生工具链平台的回退驱动；生产环境优先使用 FFI 驱动（ffi-driver.ts）。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { ConnectionInfo, DelayResult, MihomoVersion, ProxyItem } from '@teyvat-arkhon/shared'
import { RestClient, type MihomoConnections, type MihomoProxyMap } from './rest-client'
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

  constructor(private readonly opts: ProcessDriverOptions) {
    this.rest = new RestClient({
      controller: opts.externalController,
      secret: opts.secret,
      fetchImpl: opts.fetchImpl
    })
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 10_000
  }

  get running(): boolean {
    return this.child !== null && !this.exited
  }

  async start(): Promise<void> {
    if (this.running) return

    const binary = this.opts.binaryPath
    this.exited = false
    try {
      this.child = spawn(binary, ['-d', this.opts.workingDir], {
        windowsHide: true,
        stdio: 'ignore'
      })
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

  async getVersion(): Promise<MihomoVersion> {
    const v = await this.rest.get<MihomoVersion & { meta?: boolean }>('/version')
    return { version: v.version, meta: v.meta ?? false }
  }

  async getProxies(): Promise<ProxyItem[]> {
    const map = await this.rest.get<MihomoProxyMap>('/proxies')
    return Object.values(map.proxies).map((p) => ({
      name: p.name,
      type: p.type,
      nodeType: p.nodeType,
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

  async close(): Promise<void> {
    await this.stop()
  }
}