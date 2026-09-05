/**
 * mihomo external-controller RESTful API 的极简客户端。
 * 使用 Node 20+ 内置 fetch，fetch 实现可注入以便测试。
 */

export interface RestClientOptions {
  controller: string
  secret?: string
  fetchImpl?: typeof fetch
}

export class RestClient {
  private readonly baseUrl: string
  private readonly secret?: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: RestClientOptions) {
    const c = opts.controller.trim()
    this.baseUrl = /^https?:\/\//i.test(c) ? c : `http://${c}`
    this.secret = opts.secret?.trim() || undefined
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private headers(json?: unknown): Record<string, string> {
    const h: Record<string, string> = {}
    if (this.secret) h['Authorization'] = `Bearer ${this.secret}`
    if (json !== undefined) h['Content-Type'] = 'application/json'
    return h
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        /* 忽略响应体读取失败 */
      }
      throw new Error(`mihomo API ${method} ${path} -> ${res.status} ${detail}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  put(path: string, body?: unknown): Promise<unknown> {
    return this.request('PUT', path, body)
  }

  patch(path: string, body?: unknown): Promise<unknown> {
    return this.request('PATCH', path, body)
  }

  delete(path: string): Promise<unknown> {
    return this.request('DELETE', path)
  }
}

/** mihomo 代理数据形状（GET /proxies） */
export interface MihomoProxyMap {
  proxies: Record<string, MihomoProxyEntry>
}

export interface MihomoProxyEntry {
  name: string
  type: string
  nodeType: number
  now?: string
  alive?: boolean
  history?: Array<{ time: string; delay: number }>
  all?: string[]
  bot?: boolean
}

/** 活跃连接与累计流量（GET /connections） */
export interface MihomoConnections {
  downloadTotal: number
  uploadTotal: number
  connections: MihomoConnectionEntry[]
}

export interface MihomoConnectionEntry {
  id: string
  metadata: {
    host: string
    type: string
    network: string
    process?: string
    [key: string]: unknown
  }
  download: number
  upload: number
  start: string
  chains: string[]
  rule: string
  rulePayload?: string
}