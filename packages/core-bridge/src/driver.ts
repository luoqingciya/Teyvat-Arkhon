import type { ConnectionInfo, CoreStatus, DelayResult, MihomoVersion, ProxyItem } from '@teyvat-arkhon/shared'

/** 核心驱动统一接口：FFI 直连驱动与进程驱动实现同一契约，运行时按配置切换 */
export interface CoreDriver {
  readonly kind: 'ffi' | 'process'

  /** 启动核心并等待就绪（进程驱动会轮询 external-controller） */
  start(configPath: string): Promise<void>

  /** 停止核心，等待进程退出/内核回收 */
  stop(): Promise<void>

  /** 热重载配置（核心须已运行） */
  reload(configPath: string): Promise<void>

  /** 内核版本信息 */
  getVersion(): Promise<MihomoVersion>

  /** 获取策略组与节点列表（扁平化） */
  getProxies(): Promise<ProxyItem[]>

  /** 切换策略组选中节点 */
  selectProxy(groupName: string, nodeName: string): Promise<void>

  /** 测试节点/组延迟 */
  testDelay(name: string, url?: string, timeoutMs?: number): Promise<DelayResult>

  /** 获取活跃连接与累计流量 */
  getConnections(): Promise<{ downloadTotal: number; uploadTotal: number; connections: ConnectionInfo[] }>

  /** 释放资源（进程结束、句柄清理） */
  close(): Promise<void>
}

export type { CoreStatus }