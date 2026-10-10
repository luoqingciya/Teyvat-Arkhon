/**
 * Teyvat Arkhon - 跨端共享类型定义
 */

/** 内核类型 */
export interface MihomoVersion {
  version: string
  meta: boolean
  premium?: boolean
}

/**
 * 界面语言（渲染端 i18next 与主进程 i18n 共用的取值）。
 * 主进程侧用于托盘菜单、原生对话框、网络自检结果等由主进程直接产出的文案。
 */
export type UiLanguage = 'zh-CN' | 'en-US'

/** 支持的界面语言全集 */
export const UI_LANGUAGES: UiLanguage[] = ['zh-CN', 'en-US']

/** 默认界面语言 */
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'zh-CN'

/** 判定任意值是否为受支持的界面语言 */
export function isUiLanguage(v: unknown): v is UiLanguage {
  return v === 'zh-CN' || v === 'en-US'
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

/**
 * mihomo 内核 NodeType 语义（数值与内核定义一致）：
 * 0=单节点；1=URLTest；2=Selector；3=Fallback；4=LoadBalance；5=Relay。
 * 内核 REST `/proxies` 不返回该字段，需由 `type` 推断（见 `inferNodeType`）。
 */
export const NODE_TYPE = {
  Node: 0,
  URLTest: 1,
  Selector: 2,
  Fallback: 3,
  LoadBalance: 4,
  Relay: 5
} as const

/**
 * 由内核返回的 proxy.type 推断 nodeType。
 * 单一真相来源：主进程（core-bridge）与渲染进程共用本函数，避免两侧各写一份映射。
 */
export function inferNodeType(type: string): number {
  switch (type) {
    case 'Selector':
      return NODE_TYPE.Selector
    case 'URLTest':
      return NODE_TYPE.URLTest
    case 'Fallback':
      return NODE_TYPE.Fallback
    case 'LoadBalance':
      return NODE_TYPE.LoadBalance
    case 'Relay':
      return NODE_TYPE.Relay
    default:
      return NODE_TYPE.Node
  }
}

/** 是否为策略组（URLTest / Selector / Fallback / LoadBalance / Relay），即"可切换/可测速的组" */
export function isGroupNodeType(nodeType: number): boolean {
  return nodeType >= NODE_TYPE.URLTest && nodeType <= NODE_TYPE.Relay
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
  /** 'process'=应用内启动内核进程；'service'=接管系统服务托管的常驻内核（NSSM） */
  driver: 'process' | 'service'
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

/**
 * 实时流量快照（轮询 /connections 计算），**仅含轻量字段**。
 * 连接明细体积大，走独立的订阅通道（`onConnections`），此处只带数量，
 * 避免每秒向所有窗口结构化克隆整个连接数组。
 */
export interface TrafficSnapshot {
  downloadSpeed: number
  uploadSpeed: number
  downloadTotal: number
  uploadTotal: number
  /** 当前活跃连接数（明细需经 subscribeConnections + onConnections 获取） */
  connectionCount: number
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

/** 规则集（rule-provider）的行为语义 */
export type RuleProviderBehavior = 'domain' | 'ipcidr' | 'classical' | 'mrs'

/** rule-provider（规则集）元信息 */
export interface RuleProvider {
  name: string
  /** http=远程 URL；file=本地文件路径 */
  type: 'http' | 'file'
  /** 规则行为语义：domain / ipcidr / classical / mrs */
  behavior: RuleProviderBehavior
  /** http 型 provider 的远程 URL */
  url?: string
  file?: string
  /** http 型 provider 的自动刷新间隔（秒，mihomo 语义） */
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

/**
 * 内置规则模板（内联规则）。
 * 展示名与说明**不放在本包**——由渲染端按 id 从 i18n 取（`rules.templates.<id>.name/.desc`），
 * 以保持共享内核语言中立。
 */
export interface RulePreset {
  id: string
  /** 模板规则；proxy 为 DIRECT / REJECT 或 `__PROXY__` 占位（应用时由用户替换） */
  rules: RuleEntry[]
}

/** 批量粘贴规则文本的解析结果 */
export interface RuleTextParseResult {
  /** 成功解析的规则（保持输入顺序） */
  entries: RuleEntry[]
  /** 无法解析的行；行号从 1 开始，便于界面定位 */
  errors: Array<{ line: number; text: string; message: string }>
}

/**
 * 内置规则模板库（内联规则，不随上游更新）。
 *
 * 与 RECOMMENDED_RULE_SETS（provider 型，自动随上游更新）的边界：
 * 凡规则集能覆盖的一律走规则集，这里只保留规则集无法表达的"域名清单型"模板。
 * 因此原先与规则集功能重复的三项已移除，对应关系：
 *   lan-direct → lancidr + private ；ads-block → reject ；cn-direct → cncidr + direct
 *
 * `{name}` 占位符表示代理组/节点名，应用时由用户替换；`DIRECT` 直连、`REJECT` 拦截为内置策略。
 * 模板规则插入到现有 rules 顶部。
 */
export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'streaming-proxy',
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
    rules: [
      { type: 'DOMAIN-SUFFIX', payload: 'openai.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'chatgpt.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'anthropic.com', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: '__PROXY__' },
      { type: 'DOMAIN-SUFFIX', payload: 'perplexity.ai', proxy: '__PROXY__' }
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
  /** fake-ip 排除列表：命中的域名不返回虚拟 IP（NTP/STUN/游戏平台等，支持通配） */
  fakeIpFilter: string[]
  /** 解析失败内核回退的系统 DNS（纯地址，多行） */
  defaultNameserver: string[]
  /** 主用 DNS */
  nameserver: string[]
  /** 兜底 DNS（仅在主用判定为高危区时触发） */
  fallback: string[]
  /** 代理节点服务器域名的专用解析通道（避免节点域名被污染/劣化） */
  proxyServerNameserver: string[]
  /** DNS 查询遵循分流规则（respect-rules，防 DNS 泄露；需代理组可用） */
  respectRules: boolean
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
/**
 * 内置 DNS 分流预设。
 * 展示名与说明由渲染端按 id 从 i18n 取（`dns.presets.items.<id>.name/.desc`），
 * 本包只保留结构性数据（settings），以保持共享内核语言中立。
 */
export interface DnsPreset {
  id: string
  settings: DnsSettings
}

/**
 * 推荐规则集条目（规则集市场）。
 * 来源为社区维护的公开规则集（Loyalsoldier/clash-rules，每日自动构建），
 * 「安装」= 下载落盘到配置目录 + 写入 rule-providers，可同时生成 RULE-SET 规则行。
 */
export interface RecommendedRuleSet {
  id: string
  /** 写入 rule-providers 的键名（也是 RULE-SET 规则行的 payload） */
  providerName: string
  behavior: RuleProviderBehavior
  url: string
  /** 自动刷新间隔（秒） */
  interval: number
  /** 建议策略：REJECT / DIRECT / __PROXY__（安装时由用户替换为代理组名） */
  suggestedProxy: string
}

/**
 * 内置推荐规则集列表（规则集市场）。
 * 展示名与说明由渲染端按 id 从 i18n 取（`rules.providers.market.<id>.name/.desc`），
 * 本包只保留结构性数据（下载地址 / 语义 / 建议策略）。
 */
export const RECOMMENDED_RULE_SETS: RecommendedRuleSet[] = [
  {
    id: 'reject',
    providerName: 'loyalsoldier-reject',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt',
    interval: 86400,
    suggestedProxy: 'REJECT'
  },
  {
    id: 'direct',
    providerName: 'loyalsoldier-direct',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'proxy',
    providerName: 'loyalsoldier-proxy',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt',
    interval: 86400,
    suggestedProxy: '__PROXY__'
  },
  {
    id: 'gfw',
    providerName: 'loyalsoldier-gfw',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt',
    interval: 86400,
    suggestedProxy: '__PROXY__'
  },
  {
    id: 'tld-not-cn',
    providerName: 'loyalsoldier-tld-not-cn',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt',
    interval: 86400,
    suggestedProxy: '__PROXY__'
  },
  {
    id: 'apple',
    providerName: 'loyalsoldier-apple',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'icloud',
    providerName: 'loyalsoldier-icloud',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'private',
    providerName: 'loyalsoldier-private',
    behavior: 'domain',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'applications',
    providerName: 'loyalsoldier-applications',
    behavior: 'classical',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'telegramcidr',
    providerName: 'loyalsoldier-telegramcidr',
    behavior: 'ipcidr',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt',
    interval: 86400,
    suggestedProxy: '__PROXY__'
  },
  {
    id: 'cncidr',
    providerName: 'loyalsoldier-cncidr',
    behavior: 'ipcidr',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  },
  {
    id: 'lancidr',
    providerName: 'loyalsoldier-lancidr',
    behavior: 'ipcidr',
    url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt',
    interval: 86400,
    suggestedProxy: 'DIRECT'
  }
]

/** 应用更新状态（设置页展示 / 主进程广播） */
export type UpdateCheckState = 'idle' | 'checking' | 'not-available' | 'available' | 'downloaded' | 'error' | 'disabled'

export interface UpdateState {
  /** 当前状态 */
  state: UpdateCheckState
  /** 当前应用版本 */
  currentVersion: string
  /** 自动检查开关（主进程持久化） */
  autoUpdate: boolean
  /** 可用新版本号（available / downloaded 时） */
  version?: string
  /** error / disabled 时的说明 */
  message?: string
}

/**
 * 内置 DNS 分流预设模板库。
 * `{name}` 占位符表示解析组名，应用时由用户替换；`--default--` 为默认统一解析组。
 */
export const DNS_PRESETS: DnsPreset[] = [
  {
    id: 'fake-ip-domestic',
    settings: {
      enable: true,
      enhancedMode: 'fake-ip',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      fakeIpFilter: [
        'dns.msftncsi.com',
        'www.msftncsi.com',
        'www.msftconnecttest.com',
        '+.market.xbox.com',
        '+.srv.nintendo.net',
        '+.stun.playstation.net',
        'xbox.*.microsoft.com',
        '*.*.xboxlive.com',
        '+.battlenet.com.cn',
        '+.wotgame.cn',
        '+.wggames.cn',
        'time.windows.com',
        'time.nist.gov',
        'time.apple.com',
        'time1.cloud.tencent.com',
        '+.ntp.org',
        '+.pool.ntp.org',
        'localhost.ptlogin2.qq.com',
        'stun.*.*',
        'stun.*.*.*',
        '+.stun.*.*',
        '+.stun.*.*.*'
      ],
      defaultNameserver: ['223.5.5.5', '119.29.29.29'],
      nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      proxyServerNameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      respectRules: false,
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
    settings: {
      enable: true,
      enhancedMode: 'redir-host',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      fakeIpFilter: [],
      defaultNameserver: ['223.5.5.5', '119.29.29.29'],
      nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      proxyServerNameserver: ['https://doh.pub/dns-query'],
      respectRules: false,
      fallback: ['tls://8.8.8.8', 'tls://1.1.1.1'],
      nameserverPolicy: [
        { domain: 'geosite:cn', server: 'cn' },
        { domain: 'geosite:geolocation-!cn', server: 'fallback' }
      ]
    }
  },
  {
    id: 'minimal-direct',
    settings: {
      enable: true,
      enhancedMode: 'redir-host',
      ipv6: false,
      fakeIpRange: '198.18.0.1/16',
      fakeIpFilter: [],
      defaultNameserver: [],
      nameserver: ['https://doh.pub/dns-query'],
      proxyServerNameserver: [],
      respectRules: false,
      fallback: [],
      nameserverPolicy: []
    }
  }
]