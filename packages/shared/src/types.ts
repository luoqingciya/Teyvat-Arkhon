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