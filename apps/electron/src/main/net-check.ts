/**
 * 网络自检：经内核 mixed 端口（HTTP 代理绝对形式）发出探测请求，
 * 返回出口 IP/地区与常见流媒体站点的可达性，用于定位链路问题。
 */

import { request } from 'node:http'
import type { NetProbeResult } from '@teyvat-arkhon/shared'

export interface NetCheckOptions {
  /** 当前生效的内核本地混合端口（无配置时为 undefined） */
  getProxyPort: () => Promise<number | undefined>
  /** 单探测超时 ms */
  timeoutMs?: number
}

interface ProbeRaw {
  status: number
  body: string
  elapsedMs: number
}

function probeThroughProxy(port: number, url: string, timeoutMs: number): Promise<ProbeRaw> {
  return new Promise((resolve) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      resolve({ status: 0, body: '', elapsedMs: 0 })
      return
    }
    const started = Date.now()
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: url,
        headers: {
          host: u.host,
          'user-agent': 'TeyvatArkhon/1.0',
          accept: 'application/json,text/plain,*/*'
        }
      },
      (res) => {
        let body = ''
        res.on('data', (d: Buffer) => {
          body += d.toString()
          if (body.length > 64 * 1024) {
            // 只关心响应头与开头内容，避免大响应拖慢
            res.destroy()
          }
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, elapsedMs: Date.now() - started }))
        res.on('error', () => resolve({ status: res.statusCode ?? 0, body, elapsedMs: Date.now() - started }))
      }
    )
    req.on('error', () => resolve({ status: 0, body: '', elapsedMs: Date.now() - started }))
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'))
    })
    req.end()
  })
}

/** 解析 ipinfo.io/json 响应中的出口信息 */
function parseGeo(detail: string): string {
  try {
    const j = JSON.parse(detail) as { ip?: string; country?: string; org?: string; city?: string; region?: string }
    const parts = [j.ip, j.country, j.city && j.region ? `${j.city}, ${j.region}` : j.city, j.org]
    return parts.filter(Boolean).join(' · ')
  } catch {
    return detail.slice(0, 120)
  }
}

export interface NetChecker {
  run(): Promise<NetProbeResult[]>
}

export function createNetChecker(opts: NetCheckOptions): NetChecker {
  const timeoutMs = opts.timeoutMs ?? 8000

  return {
    async run(): Promise<NetProbeResult[]> {
      const port = await opts.getProxyPort()
      if (!port) {
        return [
          {
            key: 'unavailable',
            label: 'Proxy',
            ok: false,
            status: 0,
            detail: '内核未运行或未配置代理端口',
            elapsedMs: 0
          }
        ]
      }

      const results: NetProbeResult[] = []

      // 出口 IP / 地区 / 组织
      {
        const raw = await probeThroughProxy(port, 'https://ipinfo.io/json', timeoutMs)
        const detail =
          raw.status >= 200 && raw.status < 400 ? parseGeo(raw.body) : raw.status === 0 ? '请求失败/超时' : `HTTP ${raw.status}`
        results.push({
          key: 'ip',
          label: '出口 IP',
          ok: raw.status >= 200 && raw.status < 400,
          status: raw.status,
          detail,
          elapsedMs: raw.elapsedMs
        })
      }

      // 流媒体/服务可达性（连通级判定，非完整解锁检测）
      const targets: Array<{ key: string; label: string; url: string; reachable: (status: number) => boolean; failText: (status: number) => string }> = [
        {
          key: 'netflix',
          label: 'Netflix',
          url: 'https://www.netflix.com',
          reachable: (s) => s >= 200 && s < 400,
          failText: (s) => (s === 0 ? '不可达' : `受限 HTTP ${s}`)
        },
        {
          key: 'youtube',
          label: 'YouTube',
          url: 'https://www.youtube.com',
          reachable: (s) => s >= 200 && s < 400,
          failText: (s) => (s === 0 ? '不可达' : `受限 HTTP ${s}`)
        },
        {
          key: 'openai',
          label: 'OpenAI',
          url: 'https://api.openai.com/v1/models',
          // 401/403 说明已到达服务（未授权/受限），视为可达
          reachable: (s) => s > 0 && s !== 408 && s < 500,
          failText: (s) => (s === 0 ? '不可达' : `异常 HTTP ${s}`)
        }
      ]

      for (const t of targets) {
        const raw = await probeThroughProxy(port, t.url, timeoutMs)
        results.push({
          key: t.key,
          label: t.label,
          ok: t.reachable(raw.status),
          status: raw.status,
          detail: t.reachable(raw.status)
            ? raw.status === 401
              ? '可达（需鉴权）'
              : raw.status === 403
                ? '可达（区域受限）'
                : '可达'
            : t.failText(raw.status),
          elapsedMs: raw.elapsedMs
        })
      }

      return results
    }
  }
}
