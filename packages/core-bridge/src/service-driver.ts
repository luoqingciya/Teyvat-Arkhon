/**
 * 服务驱动：接管已由系统服务（NSSM）托管的内核实例。
 * 与进程驱动共享全部 REST 数据面语义，但**不 spawn 进程**：
 * - start()：只探测 external-controller 就绪（内核由服务拉起，等待其 API 可用）
 * - stop()/close()：不杀进程（服务生命周期归系统服务管，卸载服务才停止）
 * - reload()：走 REST 热重载（配置变更直接作用到服务内唯一内核）
 */

import type {
  ConnectionInfo,
  DelayResult,
  MihomoVersion,
  ProxyItem,
  ProxyMode,
  RuleInfo
} from '@teyvat-arkhon/shared'
import { RestClient, type MihomoConnections, type MihomoProxyMap, type MihomoRules } from './rest-client'
import { inferNodeType } from './process-driver'
import type { CoreDriver } from './driver'

export interface ServiceDriverOptions {
  /** REST 外控地址，如 127.0.0.1:9090 */
  externalController: string
  /** 外控密钥（可为空） */
  secret: string
  /** fetch 注入（测试用） */
  fetchImpl?: typeof fetch
  /** 服务内核就绪等待超时 ms（服务刚启动时 API 可能尚未可用） */
  startupTimeoutMs?: number
}

const READY_POLL_INTERVAL = 250

export class ServiceCoreDriver implements CoreDriver {
  readonly kind = 'service' as const

  private readonly rest: RestClient
  private readonly startupTimeoutMs: number
  private started = false

  constructor(private readonly opts: ServiceDriverOptions) {
    this.rest = new RestClient({
      controller: opts.externalController,
      secret: opts.secret,
      fetchImpl: opts.fetchImpl
    })
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 10_000
  }

  /** 服务接管无"运行中"进程概念；以是否已连接表示 */
  get attached(): boolean {
    return this.started
  }

  async start(): Promise<void> {
    if (this.started) return
    const deadline = Date.now() + this.startupTimeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        await this.rest.get('/version')
        this.started = true
        return
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL))
      }
    }
    throw new Error(
      `未检测到系统服务托管的内核（${this.opts.externalController} 未就绪）。` +
        '请确认「系统服务托管」已安装并运行，或卸载服务后改用常规模式。' +
        `原始错误: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    )
  }

  /** 服务由系统托管：停止不杀进程 */
  async stop(): Promise<void> {
    this.started = false
  }

  async close(): Promise<void> {
    this.started = false
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
      const groupRes = await this.rest.get<{ delay?: number }>(`/group/${encodeURIComponent(name)}/delay?${q}`)
      if (typeof groupRes.delay === 'number') return { node: name, delay: groupRes.delay }
    } catch {
      /* 节点与组端点均失败 */
    }
    return { node: name, delay: -1, error: groupError instanceof Error ? groupError.message : String(groupError) }
  }

  async listDelaySnapshot(): Promise<Record<string, number | null>> {
    try {
      const res = await this.rest.get<{ proxies: Record<string, { delay?: number | null }> }>('/delay/latest')
      const out: Record<string, number | null> = {}
      for (const [name, entry] of Object.entries(res.proxies ?? {})) {
        out[name] = typeof entry.delay === 'number' && entry.delay > 0 ? entry.delay : null
      }
      return out
    } catch {
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

  /** 服务内核日志不经 App 环形缓冲；后续可接 REST /logs，暂时返回空 */
  getLogs(): string[] {
    return []
  }
}