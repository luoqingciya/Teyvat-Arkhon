/**
 * macOS 系统代理：networksetup 逐网络服务设置 web/secureweb/socks 代理。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemProxyState } from '@teyvat-arkhon/shared'
import type { PlatformSystemProxy } from '.'

const execFileAsync = promisify(execFile)

export class DarwinSystemProxy implements PlatformSystemProxy {
  async read(): Promise<SystemProxyState> {
    const services = await this.listServices()
    if (!services.length) return { enabled: false }
    const svc = services[0]
    try {
      const { stdout } = await execFileAsync('networksetup', ['-getwebproxy', svc])
      const enabled = /Enabled:\s*Yes/i.test(stdout)
      const port = stdout.match(/Port:\s*(\d+)/i)?.[1]
      return { enabled, http: enabled ? `127.0.0.1:${port}` : undefined }
    } catch {
      return { enabled: false }
    }
  }

  async apply(enabled: boolean, httpPort: number): Promise<SystemProxyState> {
    const services = await this.listServices()
    const proxy = '127.0.0.1'
    const bypass = ['127.0.0.1', 'localhost', '*.local', '192.168.*', '10.*']

    for (const svc of services) {
      const state = enabled ? 'on' : 'off'
      await execFileAsync('networksetup', ['-setwebproxy', svc, proxy, String(httpPort), state])
      await execFileAsync('networksetup', ['-setsecurewebproxy', svc, proxy, String(httpPort), state])
      await execFileAsync('networksetup', ['-setsocksfirewallproxy', svc, proxy, String(httpPort), state])
      if (enabled) {
        await execFileAsync('networksetup', ['-setproxybypassdomains', svc, ...bypass])
      }
    }
    return { enabled, http: enabled ? `${proxy}:${httpPort}` : undefined }
  }

  /** 列出可用网络服务（跳过 * 开头 = 停用服务） */
  private async listServices(): Promise<string[]> {
    const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices'])
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('*') && !s.startsWith('An asterisk'))
  }
}