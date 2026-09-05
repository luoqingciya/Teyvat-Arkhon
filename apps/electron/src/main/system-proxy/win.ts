/**
 * Windows 系统代理：HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
 * 使用 reg.exe 免提权写入当前用户代理设置（Chrome/Edge 等即时生效；
 * 其他应用在下一次系统刷新时生效）。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemProxyState } from '@teyvat-arkhon/shared'
import type { PlatformSystemProxy } from '.'

const execFileAsync = promisify(execFile)

const IS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export class WindowsSystemProxy implements PlatformSystemProxy {
  async read(): Promise<SystemProxyState> {
    try {
      const { stdout } = await execFileAsync('reg', ['query', IS_KEY, '/v', 'ProxyEnable'])
      const enabled = /0x1/i.test(stdout)
      const { stdout: server } = await execFileAsync('reg', ['query', IS_KEY, '/v', 'ProxyServer'])
      const m = server.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
      const value = m ? m[1].trim() : ''
      const [http] = value.split(';')
      return { enabled, http: enabled ? http.split('=')[1] ?? http : undefined }
    } catch {
      return { enabled: false }
    }
  }

  async apply(enabled: boolean, httpPort: number): Promise<SystemProxyState> {
    const server = `127.0.0.1:${httpPort}`
    const bypass = '<local>;localhost;127.0.0.1;192.168.*;10.*;*.local'

    if (enabled) {
      await execFileAsync('reg', ['add', IS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'])
      await execFileAsync('reg', ['add', IS_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', server, '/f'])
      await execFileAsync('reg', ['add', IS_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', bypass, '/f'])
    } else {
      await execFileAsync('reg', ['add', IS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'])
    }
    return { enabled, http: enabled ? server : undefined }
  }
}