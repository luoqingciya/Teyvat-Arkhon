/**
 * Teyvat Arkhon - 跨端共享类型定义
 */

/** 内核类型 */
export interface MihomoVersion {
  version: string
  meta: boolean
  premium?: boolean
}

/** 策略组/节点 */
export interface ProxyItem {
  name: string
  type: string
  nodeType: number
  now?: string
  alive?: boolean
  history?: Array<{ time: string; delay: number }>
  all?: string[]
  bot?: boolean
}

/** 订阅配额信息（来自 subscription-userinfo 响应头，仅 URL 订阅） */
export interface ProfileSubInfo {
  /** 已用上传字节 */
  upload?: number
  /** 已用下载字节 */
  download?: number
  /** 总可用流量字节 */
  total?: number
  /** 到期时间戳（秒） */
  expire?: number
}

/** 订阅配置档案 */
export interface Profile {
  id: string
  name: string
  /** 订阅 URL，本地导入为空 */
  url?: string
  /** 更新时间 (ISO) */
  updatedAt: string
  /** 是否当前使用 */
  selected: boolean
  /** 解析出的节点数量 */
  nodeCount?: number
  /** 订阅流量/到期信息（URL 订阅携带 subscription-userinfo 时解析） */
  subInfo?: ProfileSubInfo
}

/** 解析后的核心配置摘要 */
export interface ClashConfigSummary {
  mixedPort?: number
  httpPort?: number
  socksPort?: number
  externalController?: string
  secret?: string
  tunEnabled?: boolean
  proxies: Array<{ name: string; type: string }>
  proxyGroups: Array<{ name: string; type: string }>
}

/** 内核运行状态 */
export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

/** 代理运行模式（mihomo mode） */
export type ProxyMode = 'rule' | 'global' | 'direct'

export interface CoreStatus {
  state: CoreState
  version?: MihomoVersion
  driver: 'process'
  /** 当前运行模式（运行态有效） */
  mode?: ProxyMode
}

/** 系统代理状态 */
export interface SystemProxyState {
  enabled: boolean
  http?: string
  socks?: string
  mixed?: string
}

/** 节点延迟测试结果 */
export interface DelayResult {
  node: string
  delay: number
  error?: string
}

/** 活跃连接条目（来自 REST /connections） */
export interface ConnectionInfo {
  id: string
  host: string
  type: string
  network: string
  process?: string
  download: number
  upload: number
  start: string
  chains: string[]
  rule: string
  rulePayload?: string
}

/** 实时流量快照（轮询 /connections 计算） */
export interface TrafficSnapshot {
  downloadSpeed: number
  uploadSpeed: number
  downloadTotal: number
  uploadTotal: number
  connections: ConnectionInfo[]
}

/** 路由规则条目（来自 REST /rules，路由模式 rule 有效） */
export interface RuleInfo {
  /** 规则类型，如 DOMAIN-SUFFIX / IP-CIDR / MATCH */
  type: string
  /** 规则匹配目标（域名/网段/端口等） */
  payload: string
  /** 规则指向的代理组或节点 */
  proxy: string
  /** 累计命中次数（内核运行期统计，重启清零） */
  hits: number
}

/** Windows 系统服务状态 */
export type ServiceState = 'installed' | 'running' | 'stopped' | 'not-installed' | 'unknown'

export interface SystemServiceState {
  name: string
  state: ServiceState
  error?: string
}

/** 网络自检：单项探测结果（经内核代理链路发出） */
export interface NetProbeResult {
  /** 探测目标标识，如 ip / netflix / youtube / openai */
  key: string
  label: string
  /** 探测是否完成（完成不代表可达） */
  ok: boolean
  /** HTTP 状态码（网络错误时为 0） */
  status: number
  /** 附加信息：IP / 地区 / 组织 / 错误信息 */
  detail?: string
  /** 探测耗时 ms */
  elapsedMs: number
}

/** UWP 回环豁免状态（Windows） */
export interface LoopbackState {
  /** 平台是否支持（非 Windows 恒为 false） */
  supported: boolean
  /** 已豁免的应用数（-s 输出解析，0 表示未知/无） */
  exemptCount: number
  /** 最近一次操作结果说明 */
  note?: string
}

/**
 * 分流规则（Clash `rules` 数组）可识别的规则类型。
 * 用于可视化编辑器的类型下拉、行校验与命中调试的语义判断。
 */
export type RuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'DOMAIN-REGEX'
  | 'GEOSITE'
  | 'GEOIP'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'SRC-IP-CIDR'
  | 'SRC-PORT'
  | 'DST-PORT'
  | 'PROCESS-NAME'
  | 'PROCESS-PATH'
  | 'NETWORK'
  | 'RULE-SET'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'MATCH'

/** 规则类型带语义分组：规则类型列表（含 BGP 类、无 payload 类等按语义区分匹配能力） */
export const RULE_TYPES: RuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'SRC-PORT',
  'DST-PORT',
  'PROCESS-NAME',
  'PROCESS-PATH',
  'NETWORK',
  'RULE-SET',
  'AND',
  'OR',
  'NOT',
  'MATCH'
]

/** 规则类型说明（编辑器下拉的辅助文字） */
export const RULE_TYPE_HINTS: Record<string, string> = {
  DOMAIN: '精确匹配域名',
  'DOMAIN-SUFFIX': '匹配域名及子域',
  'DOMAIN-KEYWORD': '域名包含关键词',
  'DOMAIN-REGEX': '域名正则匹配',
  GEOSITE: '按 geosite 分类匹配',
  GEOIP: '按 IP 归属地匹配',
  'IP-CIDR': 'IP 网段匹配',
  'IP-CIDR6': 'IPv6 网段匹配',
  'SRC-IP-CIDR': '源 IP 网段匹配',
  'SRC-PORT': '源端口匹配',
  'DST-PORT': '目标端口匹配',
  'PROCESS-NAME': '按进程名匹配',
  'PROCESS-PATH': '按进程路径匹配',
  NETWORK: '按网络类型(mixed/tcp/udp)匹配',
  'RULE-SET': '引用规则集(rule-provider)',
  AND: '逻辑与（子规则）',
  OR: '逻辑或（子规则）',
  NOT: '逻辑非（子规则）',
  MATCH: '兜底全匹配（必须末位）'
}

/**
 * 结构化分流规则条目。
 * 对应 Clash 规则行「TYPE,type 参数,策略」；MATCH 无中间段时 payload 为空。
 */
export interface RuleEntry {
  type: string
  /** 匹配目标：域名/网段/端口/规则集名等；MATCH 等兜底类为空 */
  payload: string
  /** 命中的策略：DIRECT / REJECT / 代理组或节点名 */
  proxy: string
}

/** rule-provider（规则集）元信息 */
export interface RuleProvider {
  name: string
  /** http=远程 URL；file=本地文件路径 */
  type: 'http' | 'file'
  /** 规则行为语义：domain / ipcidr */
  behavior: 'domain' | 'ipcidr'
  /** http 型 provider 的远程 URL */
  url?: string
  file?: string
  /** http 型 provider 的自动刷新间隔（分钟） */
  interval?: number
}

/** 分流规则编辑器的整体状态（工作配置的 rules + rule-providers） */
export interface RuleEditorState {
  rules: RuleEntry[]
  providers: RuleProvider[]
}

/** 单条规则的行级校验结果 */
export interface RuleLineValidation {
  entry: RuleEntry
  ok: boolean
  message?: string
}

/** 规则集内容预览（供「预览规则集」使用） */
export interface RuleProviderPreview {
  /** 规则集名 */
  name: string
  /** 是否为 http 远程规则集 */
  remote: boolean
  /** 规则集条目行数 */
  count: number
  /** 前 N 条原始行（用于展示） */
  lines: string[]
  /** 获取失败时的错误信息 */
  error?: string
}

/** 命中调试：对目标执行规则匹配的逐步结果 */
export interface RuleDebugStep {
  /** 规则在列表中的序号（0 起） */
  index: number
  /** 渲染后的规则文本（TYPE,payload,proxy） */
  rendered: string
  /** 本条是否匹配 */
  matched: boolean
  /** 未匹配的原因（可选） */
  reason?: string
}

export interface RuleDebugResult {
  /** 调试目标：域名或 IP */
  target: string
  /** 匹配方式归类：mihomo 采用域名/IP 判定，此处为尽力匹配（近似）。 */
  method: string
  /** 命中的第一条规则（无则 null） */
  matched: RuleEntry | null
  /** 逐步匹配明细 */
  steps: RuleDebugStep[]
}

/** 内置分流预设模板元信息（模板规则本人前端组装后经 saveRuleEditorState 落盘） */
export interface RulePresetMeta {
  id: string
  name: string
  desc?: string
}

/** 内置规则预设的具体内容 */
export interface RulePreset {
  id: string
  name: string
  desc?: string
  /** 模板规则；proxy 为 DIRECT / REJECT 或 `__PROXY__` 占位（应用时由用户替换） */
  rules: RuleEntry[]
}

/**
 * 内置分流预设模板库。
 * `{name}` 占位符表示代理组/节点名，应用时由用户替换；`DIRECT` 直连、`REJECT` 拦截为内置策略。
 * 模板规则插入到现有 rules 顶部。
 */
export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'lan-direct',
    name: '本地与局域网直连',
    desc: '回环、内网、组播直接连接，不走代理（默认添加在最前）',
    rules: [
      { type: 'IP-CIDR', payload: '127.0.0.0/8', proxy: 'DIRECT' },
      { type: 'IP-CIDR', payload: '10.0.0.0/8', proxy: 'DIRECT' },
      { type: 'IP-CIDR', payload: '172.16.0.0/12', proxy: 'DIRECT' },
      { type: 'IP-CIDR', payload: '192.168.0.0/16', proxy: 'DIRECT' },
      { type: 'GEOIP', payload: 'LAN', proxy: 'DIRECT' }
    ]
  },
  {
    id: 'ads-block',
    name: '广告与追踪拦截',
    desc: '常见广告/追踪域名拦截（REJECT）',
    rules: [
      { type: 'DOMAIN-SUFFIX', payload: 'doubleclick.net', proxy: 'REJECT' },
      { type: 'DOMAIN-SUFFIX', payload: 'googlesyndication.com', proxy: 'REJECT' },
      { type: 'DOMAIN-SUFFIX', payload: 'googleadservices.com', proxy: 'REJECT' },
      { type: 'DOMAIN-SUFFIX', payload: 'googletagmanager.com', proxy: 'REJECT' },
      { type: 'DOMAIN-SUFFIX', payload: 'scorecardresearch.com', proxy: 'REJECT' }
    ]
  },
  {
    id: 'streaming-proxy',
    name: '流媒体走代理',
    desc: '常见流媒体域名走 {name} 全局代理',
    rules: [
      { type: 'DOMAIN-SUFFIX', payload: 'netflix.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'nflxvideo.net', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'youtube.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'googlevideo.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'spotify.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'disneyplus.com', proxy: '__PROXY__' }
    ]
  },
  {
    id: 'ai-proxy',
    name: 'AI 服务走代理',
    desc: '主流 AI 服务域名走 {name} 代理',
    rules: [
      { type: 'DOMAIN-SUFFIX', payload: 'openai.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'chatgpt.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'anthropic.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'perplexity.ai', proxy: '__PROXY__' }
    ]
  },
  {
    id: 'cn-direct',
    name: '中国大陆直连',
    desc: 'geosite+geoip 中国直连，其余走 {name}（放到 rules 末尾、MATCH 之前）',
    rules: [
      { type: 'GEOSITE', payload: 'cn', proxy: 'DIRECT' },
      { type: 'GEOIP', payload: 'CN', proxy: 'DIRECT' }
    ]
  }
]

/** enhanced-mode 取值：DNS 解析增强模式 */
export type DnsEnhancedMode = 'redir-host' | 'fake-ip'

/** DNS 分流配置的顶层状态（工作配置的 dns 段，供可视化编辑） */
export interface DnsSettings {
  /** 是否启用 DNS 配置。为 false 时保留配置文本但内核不启用（对应 enable: false） */
  enable: boolean
  /** redir-host / fake-ip */
  enhancedMode: DnsEnhancedMode
  /** 是否优先 IPv6 */
  ipv6: boolean
  /** fake-ip 地址池（仅 fake-ip 模式有意义） */
  fakeIpRange: string
  /** 解析失败内核回退的系统 DNS（纯地址，多行） */
  defaultNameserver: string[]
  /** 主用 DNS */
  nameserver: string[]
  /** 兜底 DNS（仅在主用判定为高危区时触发） */
  fallback: string[]
  /** 域名级 DNS 策略：域名 → 解析组名 */
  nameserverPolicy: DnsPolicyEntry[]
}

/** 域名级 DNS 策略条目 */
export interface DnsPolicyEntry {
  /** 域名、子域或域名后缀（如 google.com、.cn） */
  domain: string
  /** 指向的解析组（nameserver-policy 的值，如 `cn` 或一个内联地址） */
  server: string
}

/** 内置 DNS 分流预设模板元信息 */
export interface DnsPresetMeta {
  id: string
  name: string
  desc?: string
}

/** 内置 DNS 分流预设模板具体内容 */
export interface DnsPreset {
  id: string
  name: string
  desc?: string
  settings: DnsSettings
}

/**
 * 内置 DNS 分流预设模板库。
 * `{name}` 占位符表示解析组名，应用时由用户替换；`--default--` 为默认统一解析组。
 */
export const DNS_PRESETS: DnsPreset[] = [
  {
    id: 'fake-ip-domestic',
    name: 'fake-ip + 国内直连兜底',
    desc: '全局 fake-ip，nameserver 走公共 DNS，.cn / 内网域名经 `cn` 组直连解析',
    settings: {
      enable: true,
      enhancedMode: 'fake-ip',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      defaultNameserver: ['223.5.5.5', '119.29.29.29'],
      nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      fallback: ['tls://8.8.8.8', 'tls://1.1.1.1'],
      nameserverPolicy: [
        { domain: 'geosite:cn', server: 'cn' },
        { domain: 'geosite:geolocation-!cn', server: 'proxy' },
        { domain: 'geosite:google', server: 'proxy' }
      ]
    }
  },
  {
    id: 'redir-host-exchange',
    name: 'redir-host 公平分流',
    desc: 'redir-host 模式，nameserver 主用 + fallback 防污染，域名级策略拆分国内/国外',
    settings: {
      enable: true,
      enhancedMode: 'redir-host',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      defaultNameserver: ['223.5.5.5', '119.29.29.29'],
      nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      fallback: ['tls://8.8.8.8', 'tls://1.1.1.1'],
      nameserverPolicy: [
        { domain: 'geosite:cn', server: 'cn' },
        { domain: 'geosite:geolocation-!cn', server: 'fallback' }
      ]
    }
  },
  {
    id: 'minimal-direct',
    name: '极简直连',
    desc: '仅用系统 DNS 与公共 DoH，无状态、无策略，适合简单直连场景',
    settings: {
      enable: true,
      enhancedMode: 'redir-host',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      defaultNameserver: [],
      nameserver: ['https://doh.pub/dns-query'],
      fallback: [],
      nameserverPolicy: []
    }
  }
]