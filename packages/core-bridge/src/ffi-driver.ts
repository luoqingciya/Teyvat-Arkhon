/**
 * FFI 直连驱动：通过 packages/native（N-API）动态加载 libmihomo 共享库，
 * 控制面（启动/停止/热重载/版本）走进程内 C ABI 调用，零网络开销；
 * 数据面（节点列表/延迟等）仍复用 RESTful API（libmihomo 内建 external-controller）。
 */

import { createRequire } from 'node:module'
import type { ConnectionInfo, DelayResult, MihomoVersion, ProxyItem } from '@teyvat-arkhon/shared'
import type { CoreDriver } from './driver'
import { RestClient, type MihomoConnections } from './rest-client'

interface MihomoNative {
  load(libPath: string): boolean
  version(): string
  start(configPath: string): void
  stop(): void
  reload(configPath: string): void
}

export interface FFIDriverOptions {
  /** libmihomo 共享库绝对路径（.dll/.dylib/.so） */
  libPath: string
  /** 原生绑定 .node 绝对路径；缺省时从 @teyvat-arkhon/native 自动探测 */
  bindingPath?: string
  /** 数据面 REST 配置（可选，缺失时数据接口报错） */
  rest?: { controller: string; secret?: string; fetchImpl?: typeof fetch }
}

export class FFICoreDriver implements CoreDriver {
  readonly kind = 'ffi' as const

  private native: MihomoNative | null = null
  private loaded = false
  private rest: RestClient | null

  constructor(private readonly opts: FFIDriverOptions) {
    this.rest = opts.rest ? new RestClient({ controller: opts.rest.controller, secret: opts.rest.secret, fetchImpl: opts.rest.fetchImpl }) : null
  }

  private ensureNative(): MihomoNative {
    if (!this.loaded) {
      const require = createRequire(__filename)
      let binding: MihomoNative | null = null
      if (this.opts.bindingPath) {
        binding = require(this.opts.bindingPath) as MihomoNative
      } else {
        try {
          // 探测 @teyvat-arkhon/native（workspace 依赖；打包时被 externalize）
          const probe = require('@teyvat-arkhon/native') as { tryLoad?: () => unknown }
          binding = (probe.tryLoad?.() ?? null) as MihomoNative | null
        } catch {
          binding = null
        }
      }
      if (!binding) {
        throw new Error(
          '无法加载 FFI 原生绑定：未找到 .node 文件。' +
            '请先运行 pnpm native:build（需 VS Build Tools + cmake + 本机编译环境）。'
        )
      }
      try {
        binding.load(this.opts.libPath)
      } catch {
        throw new Error(`加载 libmihomo 失败: ${this.opts.libPath}（请先构建 bridge/mihomo_bridge.go 并放置共享库）`)
      }
      this.native = binding
      this.loaded = true
    }
    return this.native as MihomoNative
  }

  async start(configPath: string): Promise<void> {
    this.ensureNative().start(configPath)
    // 内嵌核心的监听/控制器绑定在 goroutine 中异步完成，等待数据面就绪
    await this.waitForControllerReady()
  }

  private async waitForControllerReady(): Promise<void> {
    if (!this.rest) return
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        await this.rest.get('/version')
        return
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('内核已启动但 external-controller 未在 10s 内就绪')
  }

  async stop(): Promise<void> {
    if (this.loaded) this.ensureNative().stop()
  }

  async reload(configPath: string): Promise<void> {
    this.ensureNative().reload(configPath)
  }

  async getVersion(): Promise<MihomoVersion> {
    const version = this.ensureNative().version()
    return { version, meta: true }
  }

  private ensureRest(): RestClient {
    if (!this.rest) throw new Error('FFI 模式未配置 REST 数据面，无法获取代理列表')
    return this.rest
  }

  async getProxies(): Promise<ProxyItem[]> {
    const map = await this.ensureRest().get<{ proxies: Record<string, ProxyItem & { nodeType: number }> }>('/proxies')
    return Object.values(map.proxies)
  }

  async selectProxy(groupName: string, nodeName: string): Promise<void> {
    await this.ensureRest().put(`/proxies/${encodeURIComponent(groupName)}`, { name: nodeName })
  }

  async testDelay(name: string, url = 'https://www.gstatic.com/generate_204', timeoutMs = 5000): Promise<DelayResult> {
    const q = new URLSearchParams({ timeout: String(timeoutMs), url })
    try {
      const res = await this.ensureRest().get<{ delay?: number }>(`/proxies/${encodeURIComponent(name)}/delay?${q}`)
      if (typeof res.delay === 'number') return { node: name, delay: res.delay }
      throw new Error('未返回延迟数据')
    } catch (e) {
      return { node: name, delay: -1, error: (e as Error).message }
    }
  }

  async getConnections(): Promise<{ downloadTotal: number; uploadTotal: number; connections: ConnectionInfo[] }> {
    const res = await this.ensureRest().get<MihomoConnections>('/connections')
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
    await this.ensureRest().delete(`/connections/${encodeURIComponent(id)}`)
  }

  async closeAllConnections(): Promise<void> {
    await this.ensureRest().delete('/connections')
  }

  async close(): Promise<void> {
    if (this.loaded) {
      try {
        this.ensureNative().stop()
      } catch {
        /* 忽略关闭异常 */
      }
    }
  }
}