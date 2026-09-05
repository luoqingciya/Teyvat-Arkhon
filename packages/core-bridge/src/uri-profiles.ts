/**
 * 第三方订阅/节点格式 → Clash/mihomo YAML 配置转换器。
 *
 * 支持（自动识别，混合内容或无法识别返回 null）：
 *   - 单节点 URI 列表：hysteria2://、ss://、vmess://、vless://、trojan://、hysteria://
 *   - sing-box 导出 JSON（outbounds 数组）
 *   - SSD（shadowsocksD）JSON
 *   - Surge 文本节点行（ss / trojan / hy2 常用写法）
 */

import { URL } from 'node:url'
import yaml from 'js-yaml'

type ProxyDef = Record<string, unknown>

const URI_PREFIXES = ['hysteria2://', 'hysteria://', 'ss://', 'vmess://', 'vless://', 'trojan://']

export function tryConvertUriProfile(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 1) 单节点 URI 列表（每行一条，允许空行/注释行）
  const uriLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (uriLines.every((l) => URI_PREFIXES.some((p) => l.toLowerCase().startsWith(p)))) {
    const proxies: ProxyDef[] = []
    for (const line of uriLines) {
      const p = parseUriLine(line)
      if (!p) return null
      proxies.push(p)
    }
    return buildClashYaml(uniqueNames(proxies))
  }

  // 2) JSON：sing-box / SSD
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const props = tryConvertJson(trimmed)
    if (props) return buildClashYaml(props)
  }

  // 3) Surge 节点行
  const surge = tryConvertSurgeLines(uriLines)
  if (surge) return buildClashYaml(surge)

  return null
}

// ---------------------------------------------------------------- URI

function parseUriLine(line: string): ProxyDef | null {
  const lower = line.toLowerCase()
  if (lower.startsWith('hysteria2://')) return parseHysteria2(line)
  if (lower.startsWith('hysteria://')) return parseHysteria(line)
  if (lower.startsWith('ss://')) return parseSs(line)
  if (lower.startsWith('vmess://')) return parseVmess(line)
  if (lower.startsWith('trojan://')) return parseTrojan(line)
  if (lower.startsWith('vless://')) return parseVless(line)
  return null
}

function uriExtra(u: URL): { name: string; q: URLSearchParams } {
  const name = u.hash.startsWith('#') ? decodeURIComponent(u.hash.slice(1)) : ''
  return { name, q: u.searchParams }
}

// ---- hysteria2（含 hysteria1 通用字段）----

function parseHysteria2(uri: string): ProxyDef {
  const u = new URL(uri)
  const { name, q } = uriExtra(u)
  const host = u.hostname
  const port = Number(u.port) || 443

  const user = u.username ? decodeURIComponent(u.username) : ''
  let password = user
  if (u.password) password = !user ? decodeURIComponent(u.password) : `${user}:${decodeURIComponent(u.password)}`

  const p: ProxyDef = { name: name || `${host}:${port}`, type: 'hysteria2', server: host, port, password }

  const sni = q.get('sni') ?? q.get('peer')
  if (sni) p.sni = sni
  if (['1', 'true', 'yes'].includes((q.get('insecure') ?? '').toLowerCase())) p['skip-cert-verify'] = true
  const obfs = q.get('obfs')
  if (obfs) p.obfs = obfs
  const obfsPwd = q.get('obfs-password') ?? q.get('obfsPassword')
  if (obfsPwd) p['obfs-password'] = obfsPwd
  const alpn = q.get('alpn')
  if (alpn) p.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  const up = q.get('up')
  if (up) p.up = up
  const down = q.get('down')
  if (down) p.down = down

  return p
}

function parseHysteria(uri: string): ProxyDef {
  const u = new URL(uri)
  const { name, q } = uriExtra(u)
  const host = u.hostname
  const port = Number(u.port) || 443
  const auth = u.username ? decodeURIComponent(u.username) : ''
  const p: ProxyDef = { name: name || `${host}:${port}`, type: 'hysteria', server: host, port, auth_str: auth }
  if (auth) p.auth_str = auth
  const up = q.get('up') ?? '50'
  const down = q.get('down') ?? '100'
  p.up = appendMbps(up)
  p.down = appendMbps(down)
  const alpn = q.get('alpn')
  if (alpn) p.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  const insecure = (q.get('insecure') ?? '').toLowerCase()
  if (['1', 'true'].includes(insecure)) p['skip-cert-verify'] = true
  const sni = q.get('peer')
  if (sni) p.sni = sni
  if (q.get('obfs')) p.obfs = q.get('obfs')!
  return p
}

function appendMbps(v: string): string {
  return /^(?:[.\d]+)$/.test(v) ? `${v} Mbps` : v
}

// ---- shadowsocks ----

function parseSs(uri: string): ProxyDef {
  const u = new URL(uri)
  const { name, q } = uriExtra(u)
  let host = u.hostname
  let port = Number(u.port) || 8388
  let cipher = 'aes-256-gcm'
  let password = ''

  // 形态 A: ss:// base64(cipher:password)@host:port   （url 解析会把 base64 塞进 username）
  // 形态 B: ss:// cipher:password@host:port
  // 形态 C: ss:// base64(cipher:password@host:port)  （整段 base64，含 @ 与端口）
  const rawAuth = u.username ? decodeURIComponent(u.username) : ''
  if (u.password) {
    // username:password 常规 userinfo
    ;[cipher, password] = splitCipherPassword(rawAuth, u.password)
    host = u.hostname
    port = Number(u.port) || 8388
  } else if (rawAuth.includes('@')) {
    // host:port 被 url 解析进 username?（"base64@host:port" 时 host 在 u.hostname）
    // 直接走: userinfo 形为 base64
    const decoded = maybeB64(rawAuth)
    if (decoded && decoded.includes('@')) {
      const [c0, rest] = splitOnce(decoded, '@')
      const [h2, pp] = splitHostPort(rest, 8388)
      ;[cipher, password] = splitCipherPasswordH(c0)
      host = h2
      port = pp
    }
  } else if (rawAuth) {
    // 尝试整段 base64(cipher:password@host:port)
    const decoded = maybeB64(uri.slice(5).split('#')[0])
    if (decoded && decoded.includes('@')) {
      const [auth0, rest] = splitOnce(decoded, '@')
      const [h2, pp] = splitHostPort(rest, 8388)
      ;[cipher, password] = splitCipherPasswordH(auth0)
      host = h2
      port = pp
    }
  }

  const p: ProxyDef = { name: name || `${host}:${port}`, type: 'ss', server: host, port, cipher, password }

  const plugin = q.get('plugin')
  if (plugin) {
    const [name0, opts] = splitOnce(plugin, ';')
    p.plugin = name0
    if (opts) p['plugin-opts'] = parseSsPluginOpts(name0, opts)
  }
  return p
}

function splitCipherPassword(cipher0: string, pwd0: string): [string, string] {
  // 可能 cipher:password 都塞在 cipher0（base64 带冒号）
  if (cipher0.includes(':')) {
    const [c, ...rest] = cipher0.split(':')
    return [c, rest.join(':') + (pwd0 ? `:${pwd0}` : '')]
  }
  return [cipher0, pwd0]
}

function splitCipherPasswordH(auth: string): [string, string] {
  const idx = auth.indexOf(':')
  return idx === -1 ? [auth, ''] : [auth.slice(0, idx), auth.slice(idx + 1)]
}

function splitHostPort(s: string, def: number): [string, number] {
  const i = s.lastIndexOf(':')
  if (i === -1) return [s, def]
  const port = Number(s.slice(i + 1))
  return [s.slice(0, i), Number.isFinite(port) && port > 0 ? port : def]
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + sep.length)]
}

function maybeB64(s: string): string | null {
  try {
    const norm = s.replace(/-/g, '+').replace(/_/g, '/')
    const buf = Buffer.from(norm, 'base64')
    const out = buf.toString('utf-8')
    if (/^[\x20-\x7e@:.\-_,/;=]+$/.test(out)) return out
    return null
  } catch {
    return null
  }
}

function parseSsPluginOpts(plugin: string, opts: string): Record<string, unknown> {
  const parts = opts.split(';').map((s) => s.trim()).filter(Boolean)
  const kv: Record<string, string> = {}
  let modeSeen = false
  const rest: string[] = []
  for (const part of parts) {
    if (part.includes('=')) {
      const [k, v] = splitOnce(part, '=')
      if (k) kv[decodeURIComponent(k.trim())] = decodeURIComponent(v.trim())
    } else if (!modeSeen || !['websocket', 'ws', 'http', 'tls'].includes(part)) {
      modeSeen = true
      rest.push(part)
    }
  }
  if (plugin === 'obfs-local' || plugin === 'simple-obfs') {
    const obfs = kv['obfs'] || rest[0] || 'http'
    const out: Record<string, unknown> = { mode: obfs }
    if (kv['obfs-host'] || kv['host']) out.host = kv['obfs-host'] || kv['host']
    if (kv['path']) out.path = kv['path']
    return out
  }
  // v2ray-plugin
  const out: Record<string, unknown> = {
    mode: kv['mode'] || 'websocket',
    tls: kv['tls'] === 'true' || kv['tls'] === '1'
  }
  if (rest.length && !out.mode) out.mode = rest[0]
  if (kv['host']) out.host = kv['host']
  if (kv['path']) out.path = kv['path']
  if (kv['tls-host']) out['tls-host'] = kv['tls-host']
  if (kv['skip-cert-verify']) out['skip-cert-verify'] = kv['skip-cert-verify'] === 'true'
  return out
}

// ---- vmess ----

function parseVmess(uri: string): ProxyDef {
  const b64 = uri.slice('vmess://'.length).split('#')[0]
  const decoded = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  let j: Record<string, unknown>
  try {
    j = JSON.parse(decoded) as Record<string, unknown>
  } catch {
    throw new Error('vmess 链接解码失败（非标准 base64 JSON）')
  }
  const s = (k: string) => (typeof j[k] === 'string' ? (j[k] as string).trim() : '')
  const host = s('add') || s('server')
  const port = Number(s('port')) || 443
  const p: ProxyDef = {
    name: s('ps') || `${host}:${port}`,
    type: 'vmess',
    server: host,
    port,
    uuid: s('id'),
    alterId: Number(s('aid')) || 0,
    cipher: s('scy') || s('security') || 'auto',
    udp: true
  }
  const net = s('net') || 'tcp'
  const hostH = s('host')
  const path = s('path')
  applyTransport(p, net, hostH, path)
  if (s('tls') === 'tls') {
    p.tls = true
    p.servername = s('sni') || hostH || host
    if (s('fp')) p['client-fingerprint'] = s('fp')
    const alpn = s('alpn')
    if (alpn) p.alpn = alpn.split(',').map((x) => x.trim()).filter(Boolean)
    if (s('allowInsecure') === '1' || s('allowInsecure') === 'true') p['skip-cert-verify'] = true
  }
  return p
}

// ---- vless ----

function parseVless(uri: string): ProxyDef {
  const u = new URL(uri)
  const { name, q } = uriExtra(u)
  const host = u.hostname
  const port = Number(u.port) || 443
  const uuid = u.username ? decodeURIComponent(u.username) : ''
  const p: ProxyDef = {
    name: name || `${host}:${port}`,
    type: 'vless',
    server: host,
    port,
    uuid,
    udp: true
  }
  applyVlessTrojanExtras(p, q, host)
  return p
}

function applyVlessTrojanExtras(p: ProxyDef, q: URLSearchParams, host: string): void {
  const security = q.get('security') ?? 'none'
  const sni = q.get('sni') ?? q.get('peer')
  const fp = q.get('fp') ?? q.get('fingerprint')
  const encryption = q.get('encryption')

  if (security === 'tls') {
    p.tls = true
    if (sni) p.servername = sni
    if (fp) p['client-fingerprint'] = fp
  } else if (security === 'reality') {
    p.tls = true
    p.servername = sni || q.get('host') || host
    if (fp) p['client-fingerprint'] = fp
    const pbk = q.get('pbk') ?? q.get('public-key')
    const sid = q.get('sid') ?? q.get('short-id')
    if (pbk || sid) p['reality-opts'] = { 'public-key': pbk ?? '', 'short-id': sid ?? '' }
  }
  if (security !== 'none' && encNonNone(encryption)) {
    // vless flow
    const flow = q.get('flow')
    if (flow) p.flow = flow
  }
  const alpn = q.get('alpn')
  if (alpn) p.alpn = alpn.split(',').map((s2) => s2.trim()).filter(Boolean)
  const insecure = (q.get('allowInsecure') ?? q.get('insecure') ?? '').toLowerCase()
  if (['1', 'true', 'yes'].includes(insecure)) p['skip-cert-verify'] = true

  const type = q.get('type') ?? q.get('net')
  const hostH = q.get('host')
  const path = q.get('path')
  applyTransport(p, type ?? 'tcp', hostH ?? '', path ?? '')
}

function encNonNone(v: string | null): boolean {
  return v !== null && v !== '' && v !== 'none'
}

function applyTransport(p: ProxyDef, net: string, hostH: string, path: string): void {
  if (net === 'ws' || net === 'websocket') {
    p.network = 'ws'
    const opts: Record<string, unknown> = {}
    if (path) opts.path = path
    if (hostH) opts.headers = { Host: hostH }
    if (Object.keys(opts).length) p['ws-opts'] = opts
  } else if (net === 'grpc') {
    p.network = 'grpc'
    if (hostH) p['grpc-opts'] = { 'grpc-service-name': hostH }
  } else if (net === 'http' || net === 'h2') {
    p.network = 'http'
    const opts: Record<string, unknown> = {}
    if (path) opts.path = [path]
    if (hostH) opts.headers = { Host: hostH }
    if (Object.keys(opts).length) p['http-opts'] = opts
  } else if (net === 'tcp') {
    // 走默认 tcp；若带 host，可加 http-opts? 保持默认
  }
}

// ---- trojan ----

function parseTrojan(uri: string): ProxyDef {
  const u = new URL(uri)
  const { name, q } = uriExtra(u)
  const host = u.hostname
  const port = Number(u.port) || 443
  const password = u.username ? decodeURIComponent(u.username) : ''
  const p: ProxyDef = { name: name || `${host}:${port}`, type: 'trojan', server: host, port, password, udp: true }

  const sni = q.get('sni') ?? q.get('peer')
  if (sni) p.sni = sni
  const alpn = q.get('alpn')
  if (alpn) p.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  const fp = q.get('fp') ?? q.get('fingerprint')
  if (fp) p['client-fingerprint'] = fp
  const insecure = (q.get('allowInsecure') ?? q.get('insecure') ?? '').toLowerCase()
  if (['1', 'true', 'yes'].includes(insecure)) p['skip-cert-verify'] = true

  const type = q.get('type') ?? q.get('net')
  const hostH = q.get('host')
  const path = q.get('path')
  applyTransport(p, type ?? 'tcp', hostH ?? '', path ?? '')
  // trojan 用 ws 时服务端 host 放在 ws host
  return p
}

// ---------------------------------------------------------------- JSON: sing-box / SSD

function tryConvertJson(text: string): ProxyDef[] | null {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(j)) {
    const out = ssdServers(j)
    return out.length ? out : null
  }
  if (!j || typeof j !== 'object') return null
  const rec = j as Record<string, unknown>
  if (Array.isArray(rec.outbounds) && rec.outbounds.length) {
    const out = singBoxOutbounds(rec.outbounds as Array<Record<string, unknown>>)
    return out.length ? out : null
  }
  if (Array.isArray(rec.servers) && rec.servers.length) {
    const out = ssdServers(rec.servers as Array<Record<string, unknown>>)
    return out.length ? out : null
  }
  return null
}

function ssdServers(servers: Array<Record<string, unknown>>): ProxyDef[] {
  const out: ProxyDef[] = []
  for (const sv of servers) {
    const server = str(sv.server)
    const port = num(sv.server_port) ?? num(sv['server-port'])
    if (!server || !port) continue
    const method = str(sv.method) || 'aes-256-gcm'
    const password = str(sv.password) || ''
    const p: ProxyDef = {
      name: str(sv.remarks) || str(sv.name) || `${server}:${port}`,
      type: 'ss',
      server,
      port,
      cipher: method,
      password
    }
    const plugin = str(sv.plugin)
    const pluginOpts = str(sv.plugin_opts) ?? str(sv['plugin-opts'])
    if (plugin) p.plugin = plugin
    if (pluginOpts) {
      const kv: Record<string, string> = {}
      for (const part of pluginOpts.split(';').map((x) => x.trim()).filter(Boolean)) {
        const [k, v] = splitOnce(part, '=')
        if (k) kv[k.trim()] = decodeURIComponent(v.trim())
      }
      p['plugin-opts'] = kv
    }
    out.push(p)
  }
  return out
}

function singBoxOutbounds(outbounds: Array<Record<string, unknown>>): ProxyDef[] {
  const out: ProxyDef[] = []
  for (const ob of outbounds) {
    const type = str(ob.type)
    if (!['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'tuic'].includes(type)) continue
    const server = str(ob.server)
    const port = num(ob.server_port)
    if (!server || !port) continue
    const name = str(ob.tag) || `${server}:${port}`
    const tls = (ob.tls && typeof ob.tls === 'object' ? ob.tls : {}) as Record<string, unknown>
    const transport =
      ob.transport && typeof ob.transport === 'object' ? (ob.transport as Record<string, unknown>) : {}
    const tn = str(transport.type)

    const p: ProxyDef = { name, type: mapSbType(type), server, port }
    if (type === 'hysteria2') {
      p.password = str(ob.password)
      if (ob.obfs && typeof ob.obfs === 'object') {
        const o = ob.obfs as Record<string, unknown>
        if (str(o.type)) p.obfs = str(o.type)
        if (str(o.password)) p['obfs-password'] = str(o.password)
      }
    } else if (type === 'tuic') {
      p.uuid = str(ob.uuid)
      p.password = str(ob.password)
      if (tls.disable_sni && str(ob.alpn)) p.alpn = [str(ob.alpn)]
    } else if (type === 'shadowsocks') {
      p.cipher = str(ob.method) || 'aes-256-gcm'
      p.password = str(ob.password)
    } else {
      // vless / vmess / trojan
      p.uuid = str(ob.uuid)
      if (type === 'vmess') {
        p.alterId = 0
        p.cipher = 'auto'
      }
      if (type === 'trojan') {
        p.password = str(ob.password) ?? ''
        if (str(xpath(ob, 'tls.server_name'))) p.sni = str(xpath(ob, 'tls.server_name'))
      }
    }

    // TLS / transport
    if (tls.enabled === true || str(tls.enabled) === 'true') {
      p.tls = true
      const servername = str(tls.server_name) || server
      if (servername) p.servername = servername
      if (Array.isArray(tls.alpn) && tls.alpn.length) p.alpn = tls.alpn.map(String)
      if (tls.insecure === true || str(tls.insecure) === 'true') p['skip-cert-verify'] = true
      const utls = tls.utls && typeof tls.utls === 'object' ? (tls.utls as Record<string, unknown>) : {}
      if (utls.enabled === true && str(utls.fingerprint)) p['client-fingerprint'] = str(utls.fingerprint)
      const reality = tls.reality && typeof tls.reality === 'object' ? (tls.reality as Record<string, unknown>) : {}
      if (str(reality.public_key) || str(reality.short_id)) {
        p['reality-opts'] = { 'public-key': str(reality.public_key) ?? '', 'short-id': str(reality.short_id) ?? '' }
      }
    }
    if (tn === 'ws' || tn === 'websocket') {
      p.network = 'ws'
      const opts: Record<string, unknown> = {}
      if (str(transport.path)) opts.path = str(transport.path)
      const headers = transport.headers
      if (headers && typeof headers === 'object') {
        const hk = (headers as Record<string, unknown>)['Host']
        if (hk) opts.headers = { Host: String(hk) }
      }
      if (Object.keys(opts).length) p['ws-opts'] = opts
    } else if (tn === 'grpc') {
      p.network = 'grpc'
      if (str(transport.service_name)) p['grpc-opts'] = { 'grpc-service-name': str(transport.service_name) }
    } else if (tn === 'http') {
      p.network = 'http'
      const opts: Record<string, unknown> = {}
      if (str(transport.path)) opts.path = [str(transport.path)]
      if (str(transport.host)) opts.headers = { Host: str(transport.host) }
      if (Object.keys(opts).length) p['http-opts'] = opts
    }
    out.push(p)
  }
  return out
}

function mapSbType(t: string): string {
  if (t === 'shadowsocks') return 'ss'
  return t
}

function xpath(obj: Record<string, unknown>, path0: string): unknown {
  return path0.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
    return undefined
  }, obj)
}

// ---------------------------------------------------------------- Surge 行

function tryConvertSurgeLines(lines: string[]): ProxyDef[] | null {
  const out: ProxyDef[] = []
  for (const line of lines) {
    if (line.startsWith('#') || !line.includes('=')) return null
    const eq = line.indexOf('=')
    const name = line.slice(0, eq).trim()
    const body = line.slice(eq + 1).trim()
    const m = /^(\w+)\s*,\s*([^,\s]+)\s*,\s*(\d+)(.*)$/.exec(body)
    if (!m) return null
    const type = m[1].toLowerCase()
    const host = m[2].trim()
    const port = Number(m[3])
    const rest = m[4]
    const kv = parseSurgeKv(rest)
    const pos = rest.split(',').map((s) => s.trim()).filter((s) => s)
    if (type === 'ss' || type === 'shadowsocks') {
      out.push({
        name,
        type: 'ss',
        server: host,
        port,
        cipher: kv['encrypt-method'] || pos.find((x) => x.includes('aes') || x.includes('chacha')) || 'aes-256-gcm',
        password: kv['password'] || pos[pos.length - 1] || ''
      })
    } else if (type === 'trojan') {
      out.push({
        name,
        type: 'trojan',
        server: host,
        port,
        password: kv['password'] || pos[pos.length - 1] || '',
        sni: kv['sni'] || host,
        udp: true
      })
    } else if (type === 'hy2' || type === 'hysteria2') {
      out.push({
        name,
        type: 'hysteria2',
        server: host,
        port,
        password: kv['password'] || kv['auth'] || '',
        ...(kv['obfs'] ? { obfs: kv['obfs'] } : {}),
        ...(kv['obfs-password'] ? { 'obfs-password': kv['obfs-password'] } : {}),
        ...(kv['sni'] ? { sni: kv['sni'] } : {}),
        ...(kv['insecure'] === '1' || kv['insecure'] === 'true' ? { 'skip-cert-verify': true } : {})
      })
    } else {
      return null
    }
  }
  return out.length ? out : null
}

function parseSurgeKv(rest: string): Record<string, string> {
  const kv: Record<string, string> = {}
  for (const seg of rest.split(',')) {
    const t = seg.trim()
    const m = /^([A-Za-z0-9\-_.]+)\s*=\s*(.*)$/.exec(t)
    if (m) kv[m[1].toLowerCase()] = m[2].trim()
  }
  return kv
}

// ---------------------------------------------------------------- 组装

function uniqueNames(proxies: ProxyDef[]): ProxyDef[] {
  const seen: Record<string, number> = {}
  return proxies.map((p) => {
    const base = String(p.name) || 'node'
    let name = base
    if (seen[name]) {
      let i = 2
      while (seen[`${base}-${i}`]) i++
      name = `${base}-${i}`
    }
    seen[name] = 1
    return { ...p, name }
  })
}

export function buildClashYaml(proxies: ProxyDef[]): string {
  const cfg = {
    'mixed-port': 7890,
    'external-controller': '127.0.0.1:9090',
    mode: 'rule',
    proxies,
    'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: [...proxies.map((p) => p.name), 'DIRECT'] }],
    rules: ['MATCH,PROXY']
  }
  return yaml.dump(cfg)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}