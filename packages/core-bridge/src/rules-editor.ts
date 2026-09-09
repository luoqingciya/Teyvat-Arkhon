/**
 * 分流规则的纯逻辑模块：
 *  - 规则行的解析 / 序列化
 *  - 规则行级校验（类型合法、三段格式、策略引用）
 *  - 工作配置 YAML 中 rules / rule-providers 段的文本级替换（保留其它内容）
 *  - 命中调试的尽力匹配（不依赖 geoip/geosite 库，标注"需内核判定"项）
 */

import {
  RULE_TYPES,
  type ClashConfigSummary,
  type RuleDebugResult,
  type RuleDebugStep,
  type RuleEntry,
  type RuleLineValidation,
  type RuleProvider
} from '@teyvat-arkhon/shared'
import yaml from 'js-yaml'

/** 不需要中间段（payload）即可成立的类型（兜底 / 全匹配类） */
const NO_PAYLOAD_TYPES = new Set(['MATCH'])

/** 逻辑组合类（子规则在 payload 中以括号包裹），本工程编辑不展开，命中判定交由内核 */
const LOGIC_TYPES = new Set(['AND', 'OR', 'NOT'])

/** 需要 geoip/geosite/规则集数据才能判定的类型（纯文本调试无法给出确切结论） */
const NEEDS_KERNEL_DATA = new Set(['GEOSITE', 'GEOIP', 'RULE-SET'])

/** 依赖源信息/进程/端口/网络，无法针对纯域名/IP 目标判定的类型 */
const NEEDS_CONNECTION_CONTEXT = new Set([
  'SRC-IP-CIDR',
  'SRC-PORT',
  'DST-PORT',
  'PROCESS-NAME',
  'PROCESS-PATH',
  'NETWORK'
])

const STRATEGY_HINTS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'])

const IPV4_CIDR_RE = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))(?:,?.*)?$/
const IPV4_RE = /^(\d{1,3}(?:\.\d{1,3}){3})$/

/**
 * 判断字符串是否为合法 IPv4 地址。
 * GEOSITE/GEOIP 等匹配寄希望于内核，这里只做纯语法判断。
 */
export function isIPv4(s: string): boolean {
  const m = IPV4_RE.exec(s.trim())
  if (!m) return false
  return m[1].split('.').every((oct) => Number(oct) >= 0 && Number(oct) <= 255)
}

/** 解析一条 Clash 规则行（形如 `DOMAIN-SUFFIX,example.com,Proxy` 或 `MATCH,Proxy`）。解析失败返回 null */
export function parseRuleText(line: string): RuleEntry | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null
  // 兼容规则行可能以缩进或空行存在
  const segs = trimmed.split(',').map((s) => s.trim())
  if (segs.length < 2) return null
  const type = segs[0].toUpperCase()
  if (!RULE_TYPES.includes(type as (typeof RULE_TYPES)[number])) return null
  if (NO_PAYLOAD_TYPES.has(type)) {
    return { type, payload: '', proxy: segs[1] }
  }
  if (segs.length < 3) return null
  return { type, payload: segs[1], proxy: segs[2] }
}

/** 将结构化规则序列化为 Clash 规则行 */
export function ruleToText(r: RuleEntry): string {
  const payload = r.payload?.trim() ?? ''
  const proxy = r.proxy?.trim() ?? ''
  if (NO_PAYLOAD_TYPES.has(r.type) || payload === '') return `${r.type},${proxy}`
  return `${r.type},${payload},${proxy}`
}

/** 从 YAML 的 rules 数组元素解析出结构化条目（过滤非法/注释行） */
export function parseRulesArray(rules: unknown): RuleEntry[] {
  if (!Array.isArray(rules)) return []
  const out: RuleEntry[] = []
  for (const item of rules) {
    if (typeof item === 'string') {
      const entry = parseRuleText(item)
      if (entry) out.push(entry)
    }
  }
  return out
}

/** 从 YAML 的 rule-providers 映射解析出 provider 列表 */
export function parseProvidersMap(providers: unknown): RuleProvider[] {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return []
  const out: RuleProvider[] = []
  for (const [name, v] of Object.entries(providers as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const p = v as Record<string, unknown>
    out.push({
      name,
      type: p.type === 'file' ? 'file' : 'http',
      behavior: p.behavior === 'ipcidr' ? 'ipcidr' : 'domain',
      url: typeof p.url === 'string' ? p.url : undefined,
      file: typeof p.path === 'string' ? p.path : typeof p.file === 'string' ? p.file : undefined,
      interval: typeof p.interval === 'number' ? p.interval : undefined
    })
  }
  return out
}

/** 序列化 provider 为 Clash rule-providers 映射对象（便于 yaml.dump） */
export function providersToMap(providers: RuleProvider[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of providers) {
    if (!p.name?.trim()) continue
    const entry: Record<string, unknown> = { type: p.type, behavior: p.behavior }
    if (p.type === 'http') {
      if (p.url) entry.url = p.url
      if (p.interval && p.interval > 0) entry.interval = p.interval
    } else {
      if (p.file) entry.path = p.file
    }
    out[p.name.trim()] = entry
  }
  return out
}

/**
 * 行级校验：类型合法、三段齐全（MATCH 不需 payload）、策略非空。
 * MATCH 允许放在非末位时给出 warning（message），但不算 error（便于临时编辑）。
 */
export function validateRule(entry: RuleEntry, strategies: Set<string>): RuleLineValidation {
  const type = (entry.type ?? '').trim()
  const payload = (entry.payload ?? '').trim()
  const proxy = (entry.proxy ?? '').trim()

  if (!type) {
    return { entry, ok: false, message: '规则类型为空' }
  }
  if (!RULE_TYPES.includes(type as (typeof RULE_TYPES)[number])) {
    return { entry, ok: false, message: `未知规则类型: ${type}` }
  }
  if (LOGIC_TYPES.has(type)) {
    return { entry, ok: true, message: '逻辑组合规则由内核判定，编辑时请手动保持子规则语法正确' }
  }
  if (!NO_PAYLOAD_TYPES.has(type) && !payload) {
    return { entry, ok: false, message: `${type} 缺少匹配目标（payload）` }
  }
  if (!proxy) {
    return { entry, ok: false, message: '缺少策略（DIRECT / REJECT / 代理组）' }
  }
  if (STRATEGY_HINTS.has(proxy.toUpperCase()) || strategies.has(proxy)) {
    return { entry, ok: true }
  }
  return { entry, ok: false, message: `策略不存在: ${proxy}（可用 DIRECT/REJECT 或已配置的代理组/节点）` }
}

/** 校验一段规则列表 */
export function validateRules(rules: RuleEntry[], strategies: Set<string>): RuleLineValidation[] {
  const validations = rules.map((r) => validateRule(r, strategies))
  const lastIdx = rules.findIndex((r) => (r.type ?? '').toUpperCase() === 'MATCH')
  if (lastIdx >= 0 && lastIdx < rules.length - 1) {
    validations[lastIdx] = {
      entry: rules[lastIdx],
      ok: true,
      message: 'MATCH 建议放在列表末尾，否则其后规则不会生效'
    }
  }
  return validations
}

/**
 * 将结构化状态序列化为新工作配置文本：
 * 文本级替换顶层 `rules:` / `rule-providers:` 块，保留配置其它所有内容（注释/顺序）。
 * 块不存在时追加到文本末尾。
 */
export function applyRulesToConfig(
  raw: string,
  rules: RuleEntry[],
  providers: RuleProvider[]
): { text: string; patchedRules: boolean; patchedProviders: boolean } {
  const lines = raw.split('\n')
  const rulesBlock = buildRulesBlock(rules)
  const providersBlock = buildProvidersBlock(providers)

  const patchedRules = replaceTopLevelBlock(lines, 'rules', rulesBlock)
  const patchedProviders = replaceTopLevelBlock(lines, 'rule-providers', providersBlock)

  let text = lines.join('\n')
  if (!patchedProviders) {
    text = text.endsWith('\n') ? text + providersBlock + '\n' : text + '\n' + providersBlock + '\n'
  }
  if (!patchedRules) {
    text = text.endsWith('\n') ? text + rulesBlock + '\n' : text + '\n' + rulesBlock + '\n'
  }
  return { text, patchedRules, patchedProviders }
}

function buildRulesBlock(rules: RuleEntry[]): string {
  const lines = rules.map((r) => `  - ${ruleToText(r)}`)
  return ['rules:'].concat(lines).join('\n')
}

function buildProvidersBlock(providers: RuleProvider[]): string {
  if (providers.length === 0) {
    return 'rule-providers: {}'
  }
  const dumped = yaml.dump(providersToMap(providers), { indent: 2 })
  const indented = dumped
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : '  ' + l))
    .join('\n')
  return `rule-providers:\n${indented}`
}

/**
 * 查找并替换文本中的某个顶层键（缩进为 0）所在块。
 * 块结束于下一个顶层键（缩进 0 的非空非 '---' 行）或文件末尾。
 * @returns 是否找到并替换
 */
function replaceTopLevelBlock(lines: string[], key: string, blockLines: string): boolean {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 顶层键：对齐 `key:`
    if (/^[A-Za-z-]+:/.test(line)) {
      const topKey = line.slice(0, line.indexOf(':')).trim()
      if (topKey === key) {
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
  const insert = blockLines.split('\n')
  lines.splice(start, end - start, ...insert)
  return true
}

/**
 * 命中调试：尽力匹配单个规则与目标。
 * 返回是否匹配；无法在纯文本层判定的类型给出 reason 说明。
 */
export function matchTargetAgainstRule(
  rule: RuleEntry,
  target: string
): { matched: boolean; reason?: string } {
  const type = (rule.type ?? '').toUpperCase()
  const payload = (rule.payload ?? '').trim()
  const t = target.trim().toLowerCase()
  const p = payload.toLowerCase()

  switch (type) {
    case 'MATCH':
      return { matched: true }

    case 'DOMAIN':
      return { matched: !isIPv4(target) && t === p }

    case 'DOMAIN-SUFFIX': {
      if (isIPv4(target)) return { matched: false }
      return { matched: t === p || t.endsWith('.' + p) }
    }

    case 'DOMAIN-KEYWORD':
      return { matched: !isIPv4(target) && t.includes(p) }

    case 'DOMAIN-REGEX': {
      if (isIPv4(target)) return { matched: false, reason: '目标是 IP，不参与 DOMAIN-REGEX' }
      try {
        return { matched: new RegExp(p).test(t) }
      } catch {
        return { matched: false, reason: 'DOMAIN-REGEX 表达式不合法' }
      }
    }

    case 'IP-CIDR':
    case 'IP-CIDR6': {
      if (isIPv4(target)) {
        if (type === 'IP-CIDR6') return { matched: false }
        const cidr = payload.split(',')[0].trim()
        return { matched: ipv4InCidr(target, cidr) }
      }
      return { matched: false, reason: '目标是域名，需先解析 IP；IP-CIDR 判定请在内核侧完成' }
    }

    case 'GEOSITE':
    case 'GEOIP':
      return { matched: false, reason: '需要 geoip/geosite 库判定，纯文本调试不适用（内核 JIT 才会命中）' }

    case 'RULE-SET':
      return { matched: false, reason: `需要展开规则集 ${payload || '(未命名)'} 内容判定` }

    case 'AND':
    case 'OR':
    case 'NOT':
      return { matched: false, reason: '逻辑组合规则需内核展开子规则后判定' }

    case 'SRC-IP-CIDR':
    case 'SRC-PORT':
    case 'DST-PORT':
    case 'PROCESS-NAME':
    case 'PROCESS-PATH':
    case 'NETWORK':
      return { matched: false, reason: `无法仅依据目标 ${target} 判定，需连接上下文` }

    default:
      return { matched: false, reason: `暂不支持的类型: ${type}` }
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | Number(oct), 0) >>> 0
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const m = IPV4_CIDR_RE.exec(cidr)
  if (!m) return false
  const addr = ipv4ToInt(ip.trim())
  if (!isIPv4(m[1])) return false
  const net = ipv4ToInt(m[1])
  const prefix = Number(m[2])
  if (prefix === 0) return true
  if (prefix > 32) return false
  const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0
  return (addr & mask) === (net & mask)
}

/**
 * 命中调试：按顺序对目标做尽力匹配，返回逐步结果。
 * @param rulesByProxy 通常前端会把同一 proxy 的规则分组传入，这里恢复为扁平列表。
 */
export function debugRulesMatch(targetInput: string, rules: RuleEntry[]): RuleDebugResult {
  const target = (targetInput ?? '').trim().toLowerCase()
  const steps: RuleDebugStep[] = []
  let matched: RuleEntry | null = null
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    const rendered = ruleToText(rule)
    const res = matchTargetAgainstRule(rule, target)
    steps.push({ index: i, rendered, matched: res.matched, reason: res.reason })
    if (res.matched) {
      matched = rule
      break
    }
  }
  return {
    target,
    method: '尽力匹配（静态度量，域名/IP 判定为主；GEOIP/GEOSITE/规则集等交由内核）',
    matched,
    steps
  }
}

/**
 * 从工作配置解析出的合法策略名集合（DIRECT/REJECT + proxies + proxy-groups）。
 */
export function strategyNamesOfSummary(summary: ClashConfigSummary | null): Set<string> {
  const set = new Set(STRATEGY_HINTS)
  if (!summary) return set
  for (const p of summary.proxies ?? []) set.add(p.name)
  for (const g of summary.proxyGroups ?? []) set.add(g.name)
  return set
}

/** 由 ruleToText 渲染的规则行触发（兼容性导出） */
export { LOGIC_TYPES, NEEDS_CONNECTION_CONTEXT, NEEDS_KERNEL_DATA }