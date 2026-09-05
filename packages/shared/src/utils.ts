/**
 * 订阅内容解析工具（纯函数，无副作用）
 */

import { ClashConfigSummary } from './types'

/** 判断订阅内容是否为 Base64 编码（去掉空白后仍为合法 base64 字符串） */
export function isBase64Profile(content: string): boolean {
  const compact = content.replace(/\s+/g, '')
  if (compact.length < 20 || compact.length % 4 === 1) return false
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) return false
  const decoded = Buffer.from(compact, 'base64')
  return decoded.toString('base64').replace(/=+$/, '') === compact.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
}

/** 尝试解码订阅负载，Base64 则解码，否则原样返回 */
export function decodeProfilePayload(content: string): string {
  if (isBase64Profile(content)) {
    const decoded = Buffer.from(content.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    if (decoded.includes(':')) return decoded
  }
  return content
}

/**
 * 从订阅文本中提取配置摘要字段。
 * 此处只做轻量正则提取（不依赖 YAML 库），供 shared 包保持零依赖。
 */
export function normalizeSubscription(text: string): {
  clean: string
  mixedPort?: string
  httpPort?: string
  socksPort?: string
  externalController?: string
  secret?: string
  tunEnabled: boolean
  rawProxyLines: string[]
} {
  let streaming = false
  let content = ''
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t === 'payload:') {
      streaming = true
      continue
    }
    if (streaming) {
      if (t.startsWith('- ') || t === '' || t.startsWith('#')) content += `${line}\n`
      else streaming = false
    }
  }

  const rawProxyLines: string[] = []
  let inProxies = false
  let brace = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!inProxies) {
      if (/^proxies:/.test(t) || t === 'payload:') {
        inProxies = t === 'payload:' ? content.length > 0 : true
        if (t !== 'payload:') brace = 1
        continue
      }
    } else if (brace > 0) {
      brace += (t.match(/{/g) || []).length - (t.match(/}/g) || []).length
      if (brace >= 0 && t !== '') rawProxyLines.push(t)
      if (brace === 0) inProxies = false
    }
  }

  const find = (key: string) => {
    const m = text.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\s]+)`))
    return m ? m[1] : undefined
  }

  return {
    clean: content,
    mixedPort: find('mixed-port'),
    httpPort: find('port'),
    socksPort: find('socks-port'),
    externalController: find('external-controller'),
    secret: find('secret'),
    tunEnabled: /^\s*mode:\s*TUN\s*$/m.test(text) || /^\s*enable:\s*true\s*$/m.test(text.split('tun:')[1] || ''),
    rawProxyLines
  }
}

/** 将摘要转换为对外暴露的结构化结果 */
export function toConfigSummary(n: ReturnType<typeof normalizeSubscription>): ClashConfigSummary {
  const proxies = n.rawProxyLines
    .filter((l) => l.startsWith('- '))
    .map((l) => {
      const m = l.replace(/^-\s*/, '').match(/(["'])?(.*?)\1\s*[,}]?/)
      return { name: m ? m[2] : l, type: 'unknown' }
    })
  return {
    mixedPort: n.mixedPort ? Number(n.mixedPort) : undefined,
    httpPort: n.httpPort ? Number(n.httpPort) : undefined,
    socksPort: n.socksPort ? Number(n.socksPort) : undefined,
    externalController: n.externalController,
    secret: n.secret,
    tunEnabled: n.tunEnabled,
    proxies,
    proxyGroups: []
  }
}