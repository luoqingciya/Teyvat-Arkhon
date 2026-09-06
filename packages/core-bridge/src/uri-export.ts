/**
 * Clash/mihomo proxy 定义 → 分享 URI 列表（v2rayN 风格）。
 * 与 uri-profiles.ts 的「URI → Clash YAML」互为逆向，用于「以 URL 分享订阅」。
 *
 * 支持导出类型：ss / vmess / vless / trojan / hysteria2 / hysteria / tuic / socks5；
 * 其余类型（wireguard、http 等）无法表示为通用分享链接，直接跳过。
 */

type ProxyDef = Record<string, unknown>

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

/** base64url（无填充、-/_），v2rayN share 链接通用编码 */
function b64url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** 节点名 fragment：#name（URL 编码，空格等保留可读性） */
function nameTag(name: string): string {
  return name ? `#${encodeURIComponent(name)}` : ''
}

function transportParams(p: ProxyDef): Record<string, string> {
  // Clash network / ws-opts / grpc-opts / http-opts → 传输层 query 参数
  const out: Record<string, string> = {}
  const net = str(p.network) || 'tcp'
  if (net === 'ws' || net === 'websocket') {
    out.type = 'ws'
    const ws = (p['ws-opts'] ?? {}) as Record<string, unknown>
    const headers = (ws.headers ?? {}) as Record<string, unknown>
    const host = str(headers['Host']) || str(headers.host)
    if (host) out.host = host
    if (str(ws.path)) out.path = str(ws.path)
  } else if (net === 'grpc') {
    out.type = 'grpc'
    const grpc = (p['grpc-opts'] ?? {}) as Record<string, unknown>
    out.serviceName = str(grpc['grpc-service-name'] || grpc.serviceName)
  } else if (net === 'http' || net === 'h2') {
    out.type = 'http'
    const h2 = (p['http-opts'] ?? {}) as Record<string, unknown>
    const headers = (h2.headers ?? {}) as Record<string, unknown>
    const host = str(headers['Host']) || str(headers.host)
    if (host) out.host = host
    const paths = Array.isArray(h2.path) ? h2.path.map(str).filter(Boolean) : []
    if (paths.length) out.path = paths[0]
  } else {
    out.type = 'tcp'
  }
  return out
}

function tlsParams(p: ProxyDef, defaultSni: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (p.tls === true || p.tls === 'true') {
    out.security = 'tls'
    const sni = str(p.servername) || str(p.sni) || defaultSni
    if (sni) out.sni = sni
  } else if (str(p['reality-opts'])) {
    out.security = 'reality'
    out.sni = str(p.servername) || str(p.sni) || str(p.server) || defaultSni
  }
  const fp = str(p['client-fingerprint'])
  if (fp) out.fp = fp
  if (Array.isArray(p.alpn)) {
    const alpn = (p.alpn as unknown[]).map(str).filter(Boolean).join(',')
    if (alpn) out.alpn = alpn
  }
  if (p['skip-cert-verify'] === true || p['skip-cert-verify'] === 'true') out.allowInsecure = '1'
  return out
}

function stripMbps(v: unknown): string {
  const s = str(v)
  return s.replace(/\s*(Mbps|mbps|M)\s*$/, '')
}

// ------------------------------------------------------------------ 各协议

function toSsUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const cipher = str(p.cipher)
  if (!server || !port || !cipher) return null
  const auth = b64url(`${cipher}:${str(p.password)}`)
  let uri = `ss://${auth}@${server}:${port}`
  const plugin = str(p.plugin)
  if (plugin) {
    const opts = (p['plugin-opts'] ?? {}) as Record<string, unknown>
    const kv = Object.entries(opts)
      .filter(([, v]) => v !== undefined && v !== '' && v !== false)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(';')
    uri += `?plugin=${encodeURIComponent(plugin + (kv ? `;${kv}` : ''))}`
  }
  return uri + nameTag(str(p.name))
}

function toVmessUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const uuid = str(p.uuid)
  if (!server || !port || !uuid) return null
  const t = transportParams(p)
  const tls = tlsParams(p, server)
  const j: Record<string, string> = {
    v: '2',
    ps: str(p.name) || `${server}:${port}`,
    add: server,
    port: String(port),
    id: uuid,
    aid: String(num(p.alterId) ?? 0),
    scy: str(p.cipher) || 'auto',
    net: t.type === 'tcp' ? 'tcp' : t.type,
    type: t.type === 'http' ? 'none' : 'none',
    host: t.host ?? '',
    path: t.path ?? '',
    tls: tls.security === 'tls' ? 'tls' : ''
  }
  if (t.serviceName) j.path = t.serviceName
  if (tls.security === 'tls') {
    if (tls.sni) j.sni = tls.sni
    if (tls.fp) j.fp = tls.fp
    if (tls.alpn) j.alpn = tls.alpn
  }
  return `vmess://${b64url(JSON.stringify(j))}` + nameTag('')
}

function toVlessUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const uuid = str(p.uuid)
  if (!server || !port || !uuid) return null
  const u = new URL(`vless://${encodeURIComponent(uuid)}@${server}:${port}`)
  u.searchParams.set('encryption', 'none')
  const t = transportParams(p)
  for (const [k, v] of Object.entries(t)) u.searchParams.set(k, v)
  const tls = tlsParams(p, server)
  for (const [k, v] of Object.entries(tls)) u.searchParams.set(k, v)
  const flow = str(p.flow)
  if (flow) u.searchParams.set('flow', flow)
  const pnk = (p['reality-opts'] ?? {}) as Record<string, unknown>
  if (tls.security === 'reality' && (str(pnk['public-key']) || str(pnk['short-id']))) {
    if (str(pnk['public-key'])) u.searchParams.set('pbk', str(pnk['public-key']))
    if (str(pnk['short-id'])) u.searchParams.set('sid', str(pnk['short-id']))
  }
  if (t.serviceName) u.searchParams.set('serviceName', t.serviceName)
  return u.toString() + nameTag(str(p.name))
}

function toTrojanUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const password = str(p.password)
  if (!server || !port || !password) return null
  const u = new URL(`trojan://${encodeURIComponent(password)}@${server}:${port}`)
  const t = transportParams(p)
  for (const [k, v] of Object.entries(t)) u.searchParams.set(k, v)
  const tls = tlsParams(p, server)
  for (const [k, v] of Object.entries(tls)) u.searchParams.set(k, v)
  const sni = str(p.sni) || str(p.servername)
  if (sni) u.searchParams.set('sni', sni)
  if (t.serviceName) u.searchParams.set('serviceName', t.serviceName)
  return u.toString() + nameTag(str(p.name))
}

function toHysteria2Uri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const password = str(p.password)
  if (!server || !port) return null
  const u = new URL(`hysteria2://${encodeURIComponent(password)}@${server}:${port}`)
  const sni = str(p.sni) || str(p.servername)
  if (sni) u.searchParams.set('sni', sni)
  if (p['skip-cert-verify'] === true || p['skip-cert-verify'] === 'true') u.searchParams.set('insecure', '1')
  const fp = str(p.fingerprint)
  if (fp) u.searchParams.set('pinSHA256', hexToColon(fp))
  if (str(p.obfs)) u.searchParams.set('obfs', str(p.obfs))
  if (str(p['obfs-password'])) u.searchParams.set('obfs-password', str(p['obfs-password']))
  if (Array.isArray(p.alpn)) {
    const alpn = (p.alpn as unknown[]).map(str).filter(Boolean).join(',')
    if (alpn) u.searchParams.set('alpn', alpn)
  }
  if (str(p.ports)) u.searchParams.set('mport', str(p.ports))
  const up = stripMbps(p.up)
  if (up) u.searchParams.set('up', up)
  const down = stripMbps(p.down)
  if (down) u.searchParams.set('down', down)
  return u.toString() + nameTag(str(p.name))
}

function toHysteriaUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const auth = str(p.auth_str)
  if (!server || !port) return null
  const u = new URL(`hysteria://${encodeURIComponent(auth)}@${server}:${port}`)
  const up = stripMbps(p.up)
  const down = stripMbps(p.down)
  if (up) u.searchParams.set('up', up)
  if (down) u.searchParams.set('down', down)
  if (str(p.obfs)) u.searchParams.set('obfs', str(p.obfs))
  const peer = str(p.sni) || str(p.servername)
  if (peer) u.searchParams.set('peer', peer)
  if (Array.isArray(p.alpn)) {
    const alpn = (p.alpn as unknown[]).map(str).filter(Boolean).join(',')
    if (alpn) u.searchParams.set('alpn', alpn)
  }
  return u.toString() + nameTag(str(p.name))
}

function toTuicUri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  const uuid = str(p.uuid)
  if (!server || !port || !uuid) return null
  const u = new URL(`tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(str(p.password))}@${server}:${port}`)
  const sni = str(p.sni) || str(p.servername)
  if (sni) u.searchParams.set('sni', sni)
  const cc = str(p['congestion-controller'] || p['congestion_controller'])
  if (cc) u.searchParams.set('congestion_control', cc)
  if (Array.isArray(p.alpn)) {
    const alpn = (p.alpn as unknown[]).map(str).filter(Boolean).join(',')
    if (alpn) u.searchParams.set('alpn', alpn)
  }
  return u.toString() + nameTag(str(p.name))
}

function toSocks5Uri(p: ProxyDef): string | null {
  const server = str(p.server)
  const port = num(p.port)
  if (!server || !port) return null
  const auth = str(p.username) ? `${encodeURIComponent(str(p.username))}:${encodeURIComponent(str(p.password))}@` : ''
  return `socks5://${auth}${server}:${port}` + nameTag(str(p.name))
}

// ------------------------------------------------------------------ 入口

function hexToColon(hex: string): string {
  // 裸 hex "BA8845" → 冒号分隔 "BA:88:45"（v2rayN pinSHA256 格式）
  const h = hex.replace(/[^0-9a-fA-F]/g, '')
  if (h.length === 0 || h.length % 2 !== 0) return str(hex)
  return h.match(/.{2}/g)!.join(':')
}

/** 将一组 Clash proxy 定义转换为分享 URI 文本（每行一条，跳过不支持的协议） */
export function clashProxiesToUriList(proxies: Array<Record<string, unknown>>): string {
  const out: string[] = []
  for (const p of proxies) {
    let uri: string | null = null
    switch (str(p.type)) {
      case 'ss':
        uri = toSsUri(p)
        break
      case 'vmess':
        uri = toVmessUri(p)
        break
      case 'vless':
        uri = toVlessUri(p)
        break
      case 'trojan':
        uri = toTrojanUri(p)
        break
      case 'hysteria2':
      case 'hy2':
        uri = toHysteria2Uri(p)
        break
      case 'hysteria':
      case 'hy':
        uri = toHysteriaUri(p)
        break
      case 'tuic':
        uri = toTuicUri(p)
        break
      case 'socks5':
        uri = toSocks5Uri(p)
        break
      default:
        continue
    }
    if (uri) out.push(uri)
  }
  return out.join('\n')
}