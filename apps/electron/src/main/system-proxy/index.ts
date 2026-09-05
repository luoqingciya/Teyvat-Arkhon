import type { SystemProxyState } from '@teyvat-arkhon/shared'
import { WindowsSystemProxy } from './win'
import { DarwinSystemProxy } from './darwin'
import { LinuxSystemProxy } from './linux'

/** 各平台系统代理实现统一接口 */
export interface PlatformSystemProxy {
  read(): Promise<SystemProxyState>
  apply(enabled: boolean, httpPort: number): Promise<SystemProxyState>
}

export type SystemProxyController = Omit<PlatformSystemProxy, 'apply'> & {
  set(enabled: boolean): Promise<SystemProxyState>
}

export interface SystemProxyControllerOptions {
  isCoreRunning: () => boolean
  /** 当前生效的本地代理端口（取自内核配置 mixed-port） */
  getHttpPort: () => Promise<number>
}

/**
 * 系统代理控制器：写操作系统代理设置。
 */
export function createSystemProxyController(
  options: SystemProxyControllerOptions
): SystemProxyController {
  const { isCoreRunning, getHttpPort } = options
  const impl: PlatformSystemProxy =
    process.platform === 'win32'
      ? new WindowsSystemProxy()
      : process.platform === 'darwin'
        ? new DarwinSystemProxy()
        : new LinuxSystemProxy()

  return {
    read: () => impl.read(),
    async set(enabled): Promise<SystemProxyState> {
      if (enabled && !isCoreRunning()) {
        throw new Error('内核未运行，无法开启系统代理')
      }
      const httpPort = await getHttpPort()
      return impl.apply(enabled, httpPort)
    }
  }
}