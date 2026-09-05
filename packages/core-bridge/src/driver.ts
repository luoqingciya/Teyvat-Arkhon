import type {
  ConnectionInfo,
  CoreStatus,
  DelayResult,
  MihomoVersion,
  ProxyItem,
  ProxyMode
} from '@teyvat-arkhon/shared'

/** 核心驱动统一接口：当前统一使用进程驱动（稳定优先） */
export interface CoreDriver {
  readonly kind: 'process'

  /** 启动核心并等待就绪（进程驱动会轮询 external-controller） */
  start(configPath: string): Promise<void>

  /** 停止核心，等待进程退出/内核回收 */
  stop(): Promise<void>

  /** 热重载配置（核心须已运行） */
  reload(configPath: string): Promise<void>

  /** 内核版本信息 */
  getVersion(): Promise<MihomoVersion>

  /** 切换代理运行模式（rule/global/direct，运行态生效） */
  setMode(mode: ProxyMode): Promise<void>

  /** 获取当前运行模式（运行态） */
  getMode(): Promise<ProxyMode | undefined>

  /** 最近内核日志（顶格 N 条） */
  getLogs(): string[]

  /** 获取策略组与节点列表（扁平化） */
  getProxies(): Promise<ProxyItem[]>

  /** 切换策略组选中节点 */
  selectProxy(groupName: string, nodeName: string): Promise<void>

  /** 测试节点/组延迟 */
  testDelay(name: string, url?: string, timeoutMs?: number): Promise<DelayResult>

  /** 获取活跃连接与累计流量 */
  getConnections(): Promise<{ downloadTotal: number; uploadTotal: number; connections: ConnectionInfo[] }>

  /** 关闭指定连接 */
  closeConnection(id: string): Promise<void>

  /** 关闭全部连接 */
  closeAllConnections(): Promise<void>

  /** 释放资源（进程结束、句柄清理） */
  close(): Promise<void>
}

export type { CoreStatus }