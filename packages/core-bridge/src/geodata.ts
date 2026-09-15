/**
 * geodata 本地解析：geosite.dat / geoip.dat（v2ray protobuf 格式）。
 *  - 最小 wire-format 读取器（varint + length-delimited），无第三方依赖
 *  - 供规则命中调试做 GEOSITE/GEOIP 的本地真实判定（与内核使用的同一份数据文件）
 *
 * proto 结构（v2ray domain-list-community / geoip）：
 *   GeoSiteList { repeated GeoSite entry = 1 }
 *   GeoSite     { string country_code = 1; repeated Domain domains = 2 }
 *   Domain      { Type type = 1 (0=Plain子串 1=Regex 2=后缀 3=Full); string value = 2 }
 *   GeoIPList   { repeated GeoIP entry = 1 }
 *   GeoIP       { string country_code = 1; repeated CIDR cidr = 2 }
 *   CIDR        { bytes ip = 1; uint32 prefix = 2 }
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { RuleMatchContext } from './rules-editor'

interface PbField {
  field: number
  intValue?: number
  bytesValue?: Buffer
}

/** 读取 varint，返回 [值, 新位置] */
function readVarint(buf: Buffer, pos: number): [number, number] {
  let value = 0
  let shift = 0
  while (pos < buf.length) {
    const b = buf[pos++]!
    value += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return [value, pos]
}

/** 遍历 protobuf 消息的全部字段（跳过未使用的 fixed32/64） */
function* iterateFields(buf: Buffer): Generator<PbField> {
  let pos = 0
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos)
    pos = p1
    const field = key >>> 3
    const wireType = key & 7
    if (wireType === 0) {
      const [v, p2] = readVarint(buf, pos)
      pos = p2
      yield { field, intValue: v }
    } else if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos)
      pos = p2
      yield { field, bytesValue: buf.subarray(pos, pos + len) }
      pos += len
    } else if (wireType === 5) {
      pos += 4
    } else if (wireType === 1) {
      pos += 8
    } else {
      // 无法继续安全解析
      return
    }
  }
}

/** geosite 域名条目：type 语义见文件头注释 */
interface GeositeDomain {
  type: number
  value: string
}

/** geoip 网段条目（ip 为 4/16 字节原始地址） */
interface GeoipCidr {
  ip: Buffer
  prefix: number
}

/** 内置 LAN 网段（mihomo 对 GEOIP,LAN 的语义；geoip.dat 中无该分类） */
const LAN_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]

export class GeodataMatcher {
  /** geosite 分类（key 小写，如 'cn'、'category-ads-all'） */
  private readonly geosite: Map<string, GeositeDomain[]>
  /** geoip 国家（key 大写，如 'CN'）；LAN 用内置网段 */
  private readonly geoip: Map<string, GeoipCidr[]>

  private constructor(geosite: Map<string, GeositeDomain[]>, geoip: Map<string, GeoipCidr[]>) {
    this.geosite = geosite
    this.geoip = geoip
  }

  /**
   * 从候选目录加载 geosite.dat / geoip.dat（取首个存在的文件）。
   * 两个文件都缺失时返回 null（调用方退化为「需内核判定」）。
   */
  static async load(dirs: string[]): Promise<GeodataMatcher | null> {
    const geositeBuf = await readFirst(dirs, 'geosite.dat')
    const geoipBuf = await readFirst(dirs, 'geoip.dat')
    if (!geositeBuf && !geoipBuf) return null
    return new GeodataMatcher(
      geositeBuf ? parseGeositeList(geositeBuf) : new Map(),
      geoipBuf ? parseGeoipList(geoipBuf) : new Map()
    )
  }

  /** geosite 分类是否存在（用于 UI 列出可用分类） */
  hasGeosite(code: string): boolean {
    return this.geosite.has(code.trim().toLowerCase())
  }

  /**
   * geosite 匹配：host 是否命中分类。分类不存在返回 null。
   */
  matchGeosite(code: string, host: string): boolean | null {
    const key = code.trim().toLowerCase()
    if (key === 'lan') return null
    const domains = this.geosite.get(key)
    if (!domains) return null
    const h = host.trim().toLowerCase()
    for (const d of domains) {
      const v = d.value.toLowerCase()
      switch (d.type) {
        case 2: // 后缀（含自身）
          if (h === v || h.endsWith('.' + v)) return true
          break
        case 3: // 完整匹配
          if (h === v) return true
          break
        case 1: // 正则
          try {
            if (new RegExp(d.value, 'i').test(h)) return true
          } catch {
            /* 非法正则跳过 */
          }
          break
        default: // 0=关键词子串
          if (h.includes(v)) return true
      }
    }
    return false
  }

  /**
   * geoip 匹配：IP 是否属于国家/分类。库为空或目标非法返回 null。
   */
  matchGeoip(code: string, ip: string): boolean | null {
    const key = code.trim().toUpperCase()
    const ipBuf = ipToBuffer(ip)
    if (!ipBuf) return null
    if (key === 'LAN') {
      for (const [net, prefix] of LAN_CIDRS) {
        const netBuf = ipToBuffer(net)
        if (netBuf && ipInCidrBytes(ipBuf, netBuf, prefix)) return true
      }
      return false
    }
    const cidrs = this.geoip.get(key)
    if (!cidrs) return this.geoip.size > 0 ? false : null
    for (const c of cidrs) {
      if (ipInCidrBytes(ipBuf, c.ip, c.prefix)) return true
    }
    return false
  }

  /** 转为规则命中调试的判定上下文（RULE-SET 由调用方另行拼接） */
  toMatchContext(): RuleMatchContext {
    return {
      geositeMatch: (code, host) => this.matchGeosite(code, host),
      geoipMatch: (code, ip) => this.matchGeoip(code, ip)
    }
  }
}

/** 在候选目录中读取首个存在的文件 */
async function readFirst(dirs: string[], name: string): Promise<Buffer | null> {
  for (const dir of dirs) {
    if (!dir) continue
    const file = path.join(dir, name)
    try {
      return await fs.readFile(file)
    } catch {
      /* 尝试下一个目录 */
    }
  }
  return null
}

/** 解析 GeoSiteList */
function parseGeositeList(buf: Buffer): Map<string, GeositeDomain[]> {
  const sites = new Map<string, GeositeDomain[]>()
  for (const f of iterateFields(buf)) {
    if (f.field !== 1 || !f.bytesValue) continue // GeoSite entry
    let code = ''
    const domains: GeositeDomain[] = []
    for (const g of iterateFields(f.bytesValue)) {
      if (g.field === 1 && g.bytesValue) {
        code = g.bytesValue.toString('utf8')
      } else if (g.field === 2 && g.bytesValue) {
        let type = 0
        let value = ''
        for (const d of iterateFields(g.bytesValue)) {
          if (d.field === 1 && d.intValue !== undefined) type = d.intValue
          else if (d.field === 2 && d.bytesValue) value = d.bytesValue.toString('utf8')
        }
        if (value) domains.push({ type, value })
      }
    }
    if (code) sites.set(code.toLowerCase(), domains)
  }
  return sites
}

/** 解析 GeoIPList */
function parseGeoipList(buf: Buffer): Map<string, GeoipCidr[]> {
  const countries = new Map<string, GeoipCidr[]>()
  for (const f of iterateFields(buf)) {
    if (f.field !== 1 || !f.bytesValue) continue // GeoIP entry
    let code = ''
    const cidrs: GeoipCidr[] = []
    for (const g of iterateFields(f.bytesValue)) {
      if (g.field === 1 && g.bytesValue) {
        code = g.bytesValue.toString('utf8')
      } else if (g.field === 2 && g.bytesValue) {
        let ip: Buffer | undefined
        let prefix = 0
        for (const c of iterateFields(g.bytesValue)) {
          if (c.field === 1 && c.bytesValue) ip = c.bytesValue
          else if (c.field === 2 && c.intValue !== undefined) prefix = c.intValue
        }
        if (ip) cidrs.push({ ip, prefix })
      }
    }
    if (code) countries.set(code.toUpperCase(), cidrs)
  }
  return countries
}

/** IP 字符串 → 原始字节（IPv4 4 字节 / IPv6 16 字节）；非法返回 null */
export function ipToBuffer(ip: string): Buffer | null {
  const t = ip.trim()
  if (t.includes(':')) return ipv6ToBuffer(t)
  const parts = t.split('.')
  if (parts.length !== 4) return null
  const out = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    out[i] = n
  }
  return out
}

/** IPv6 字符串 → 16 字节（支持 :: 压缩与内嵌 IPv4 尾段） */
function ipv6ToBuffer(ip: string): Buffer | null {
  const t = ip.trim()
  const dual = t.split('::')
  if (dual.length > 2) return null
  const parseGroups = (s: string): number[] => {
    if (!s) return []
    const segs = s.split(':')
    const groups: number[] = []
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!
      if (i === segs.length - 1 && seg.includes('.')) {
        // 内嵌 IPv4（如 ::ffff:1.2.3.4）
        const v4 = ipToBuffer(seg)
        if (!v4) throw new Error('bad ipv4 part')
        groups.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!)
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) throw new Error('bad group')
        groups.push(parseInt(seg, 16))
      }
    }
    return groups
  }
  let head: number[]
  let tail: number[]
  try {
    head = parseGroups(dual[0] ?? '')
    tail = dual.length === 2 ? parseGroups(dual[1] ?? '') : []
  } catch {
    return null
  }
  const total = head.length + tail.length
  if (dual.length === 2 ? total > 7 : total !== 8) return null
  const groups = dual.length === 2 ? [...head, ...Array(8 - total).fill(0), ...tail] : head
  const out = Buffer.alloc(16)
  for (let i = 0; i < 8; i++) {
    out[i * 2] = groups[i]! >> 8
    out[i * 2 + 1] = groups[i]! & 0xff
  }
  return out
}

/** 字节级 CIDR 包含判断（v4/v6 通用，长度不同视为不匹配） */
export function ipInCidrBytes(ip: Buffer, net: Buffer, prefix: number): boolean {
  if (ip.length !== net.length) return false
  const fullBits = ip.length * 8
  if (prefix > fullBits) return false
  if (prefix === 0) return true
  const bytes = Math.floor(prefix / 8)
  for (let i = 0; i < bytes; i++) {
    if (ip[i] !== net[i]) return false
  }
  const rem = prefix % 8
  if (rem === 0) return true
  const mask = (0xff << (8 - rem)) & 0xff
  return (ip[bytes]! & mask) === (net[bytes]! & mask)
}
