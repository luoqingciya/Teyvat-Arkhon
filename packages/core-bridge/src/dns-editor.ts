/**
 * DNS 分流配置的纯逻辑模块：
 *  - 从工作配置 YAML 解析 dns 段为结构化状态
 *  - 结构性校验（地址格式、必填项、fake-ip 依赖）
 *  - 将结构化状态序列化并做 dns 段的文本级替换（保留其它内容）
 *  - 内置 DNS 分流预设
 */

import {
  DNS_PRESETS,
  type DnsPresetMeta,
  type DnsSettings,
  type DnsPolicyEntry
} from '@teyvat-arkhon/shared'

/** 判定一个 DNS 服务器地址是否"纯 IP/主机"（非 doh/dot/系统等结构化协议） */
function isPlainHost(addr: string): boolean {
  const t = addr.trim()
  if (!t) return false
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && t !== 'system' && t !== 'local'
}

/** 从 yaml 顶层 dns 对象解析为结构化状态（节点缺失时返回默认空态） */
export function parseDnsSettings(cfg: Record<string, unknown> | null | undefined): DnsSettings {
  const dns = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>).dns : undefined
  const d = dns && typeof dns === 'object' && !Array.isArray(dns) ? (dns as Record<string, unknown>) : {}
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []

  const policyRaw = d['nameserver-policy']
  const policy: DnsPolicyEntry[] =
    policyRaw && typeof policyRaw === 'object' && !Array.isArray(policyRaw)
      ? Object.entries(policyRaw as Record<string, unknown>).map(([domain, server]) => ({
          domain,
          server: String(server)
        }))
      : []

  return {
    enable: d.enable !== false,
    enhancedMode: (d['enhanced-mode'] as DnsSettings['enhancedMode']) ?? 'redir-host',
    ipv6: d.ipv6 === true,
    fakeIpRange: String(d['fake-ip-range'] ?? '198.18.0.1/16'),
    defaultNameserver: strArr(d['default-nameserver']),
    nameserver: strArr(d.nameserver),
    fallback: strArr(d.fallback),
    nameserverPolicy: policy
  }
}

const yamlBoolean = (b: boolean): string => (b ? 'true' : 'false')

/** 将结构化 DNS 状态序列化为 yaml 段（含键名，缩进 2） */
export function buildDnsBlock(s: DnsSettings): string {
  const lines: string[] = ['dns:']
  lines.push(`  enable: ${yamlBoolean(s.enable)}`)
  lines.push(`  ipv6: ${yamlBoolean(s.ipv6)}`)
  lines.push(`  enhanced-mode: ${s.enhancedMode}`)
  lines.push(`  fake-ip-range: ${s.fakeIpRange || '198.18.0.1/16'}`)
  if (s.defaultNameserver.length) {
    lines.push('  default-nameserver:')
    s.defaultNameserver.forEach((a) => lines.push(`    - ${a}`))
  }
  if (s.nameserver.length) {
    lines.push(`  nameserver:`)
    s.nameserver.forEach((a) => lines.push(`    - ${a}`))
  }
  if (s.fallback.length) {
    lines.push('  fallback:')
    s.fallback.forEach((a) => lines.push(`    - ${a}`))
  }
  if (s.nameserverPolicy.length) {
    lines.push('  nameserver-policy:')
    s.nameserverPolicy.forEach((p) => lines.push(`    ${p.domain}: ${p.server}`))
  }
  return lines.join('\n')
}

/**
 * 文本级替换工作配置中的 `dns:` 顶层块；不存在时追加到末尾。
 * 返回是否找到并替换（未找到时为追加）。
 */
export function applyDnsToConfig(raw: string, s: DnsSettings): { text: string; patched: boolean } {
  const lines = raw.split('\n')
  const block = buildDnsBlock(s)
  const patched = replaceTopLevelDnsBlock(lines, block)
  let text = lines.join('\n')
  if (!patched) {
    text = text.endsWith('\n') ? text + block + '\n' : text + '\n' + block + '\n'
  }
  return { text, patched }
}

/** 查找并替换某个顶层键（缩进 0）所在块；块结束于下一个顶层键或文件末尾 */
function replaceTopLevelDnsBlock(lines: string[], blockLines: string): boolean {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^[A-Za-z-]+:/.test(lines[i])) {
      const topKey = lines[i].slice(0, lines[i].indexOf(':')).trim()
      if (topKey === 'dns') {
        start = i
        break
      }
    }
  }
  if (start === -1) return false
  let end = lines.length
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j]
    if (line !== '' && !/^\s/.test(line) && !/^\s*(#|---)/.test(line) && /^[A-Za-z-]+:/.test(line)) {
      end = j
      break
    }
  }
  lines.splice(start, end - start, ...blockLines.split('\n'))
  return true
}

/** 校验结构化 DNS：返回问题清单（空数组表示全部通过） */
export function validateDnsSettings(s: DnsSettings): string[] {
  const issues: string[] = []
  if (!s.nameserver.length) issues.push('至少需要配置一个主用 nameserver，否则 DNS 无法解析')
  if (s.enhancedMode === 'fake-ip' && !s.fakeIpRange.trim()) issues.push('fake-ip 模式需要填写 fake-ip-range 地址池')
  if (s.enable && s.nameserverPolicy.some((p) => !p.domain.trim() || !p.server.trim())) {
    issues.push('nameserver-policy 中存在空域名或空解析组')
  }
  // 纯地址检查：系统/内网地址不做限制，避免误报
  for (const a of [...s.nameserver, ...s.fallback]) {
    if (a.trim() && !isPlainHost(a)) {
      const t = a.trim()
      if (!/^(https?|tls|quic|udp|tcp|doh|dot):\/\//i.test(t)) issues.push(`无法识别的 DNS 地址：${t}`)
    }
  }
  return issues
}

/** 内置 DNS 预设元信息 */
export function listDnsPresetMetas(): DnsPresetMeta[] {
  return DNS_PRESETS.map(({ id, name, desc }) => ({ id, name, desc }))
}