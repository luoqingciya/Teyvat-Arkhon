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

/** 核心运行状态 */
export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface CoreStatus {
  state: CoreState
  version?: MihomoVersion
  driver: 'process'
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

/** Windows 系统服务状态 */
export type ServiceState = 'installed' | 'running' | 'stopped' | 'not-installed' | 'unknown'

export interface SystemServiceState {
  name: string
  state: ServiceState
  error?: string
}