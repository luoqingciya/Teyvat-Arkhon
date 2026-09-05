/**
 * 单节点分享链接（URI 列表）→ Clash/mihomo YAML 配置转换。
 *
 * 当前支持的协议：
 *   - hysteria2: `hysteria2://[auth@]host:port/?key=value#name`
 *
 * 使用场景：用户粘贴机场/客户端导出的单点链接（非完整 Clash YAML）时，
 * 自动转换为合法配置后走既有导入/校验流程。无法识别或混合内容返回 null。
 */

import { URL } from 'node:url'
import yaml from 'js-yaml'

const HY2_PREFIX = 'hysteria2://'

interface ParsedHysteria2 {
  name: string
  server: string
  port: number
  password: string
  sni?: string
  skipCertVerify?: boolean
  obfs?: string
  obfsPassword?: string
  alpn?: string[]
  up?: string
  down?: string
}

/**
 * 尝试把文本整体当作节点 URI 列表转换为 Clash YAML。
 * 仅当所有非空行均可被识别时才转换，否则返回 null（交给 YAML 解析流程报错）。
 */
export function tryConvertUriProfile(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return null

  const nodes: ParsedHysteria2[] = []
  for (const line of lines) {
    if (!line.toLowerCase().startsWith(HY2_PREFIX)) return null
    nodes.push(parseHysteria2(line))
  }
  return buildClashYaml(nodes)
}

function parseHysteria2(uri: string): ParsedHysteria2 {
  const u = new URL(uri)
  const host = u.hostname
  const port = Number(u.port) || 443
  const name = (u.hash.startsWith('#') ? decodeURIComponent(u.hash.slice(1)) : '') || `${host}:${port}`

  // auth：`password@host` 或 `user:password@host` 两种形态都接受
  const user = u.username ? decodeURIComponent(u.username) : ''
  let password = user
  if (u.password) {
    password = !user ? decodeURIComponent(u.password) : `${user}:${decodeURIComponent(u.password)}`
  }

  const q = u.searchParams
  const node: ParsedHysteria2 = { name, server: host, port, password }

  const sni = q.get('sni') ?? q.get('peer')
  if (sni) node.sni = sni

  const insecure = (q.get('insecure') ?? '').toLowerCase()
  if (['1', 'true', 'yes'].includes(insecure)) node.skipCertVerify = true

  const obfs = q.get('obfs')
  if (obfs) node.obfs = obfs
  const obfsPwd = q.get('obfs-password') ?? q.get('obfsPassword')
  if (obfsPwd) node.obfsPassword = obfsPwd

  const alpn = q.get('alpn')
  if (alpn) {
    node.alpn = alpn
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const up = q.get('up')
  if (up) node.up = up
  const down = q.get('down')
  if (down) node.down = down

  return node
}

function buildClashYaml(nodes: ParsedHysteria2[]): string {
  const scope: Record<string, boolean> = {}
  const proxies = nodes.map((n) => {
    // 节点名须唯一，否则内核会报错；重名追加序号
    let name = n.name
    if (scope[name]) {
      let i = 2
      while (scope[`${name}-${i}`]) i++
      name = `${name}-${i}`
    }
    scope[name] = true
    const p: Record<string, unknown> = {
      name,
      type: 'hysteria2',
      server: n.server,
      port: n.port,
      password: n.password
    }
    if (n.sni) p.sni = n.sni
    if (n.skipCertVerify) p['skip-cert-verify'] = true
    if (n.obfs) p.obfs = n.obfs
    if (n.obfsPassword) p['obfs-password'] = n.obfsPassword
    if (n.alpn) p.alpn = n.alpn
    if (n.up) p.up = n.up
    if (n.down) p.down = n.down
    return p
  })

  const cfg = {
    'mixed-port': 7890,
    'external-controller': '127.0.0.1:9090',
    mode: 'rule',
    proxies,
    'proxy-groups': [
      { name: 'PROXY', type: 'select', proxies: [...proxies.map((p) => p.name), 'DIRECT'] }
    ],
    rules: ['MATCH,PROXY']
  }
  return yaml.dump(cfg)
}