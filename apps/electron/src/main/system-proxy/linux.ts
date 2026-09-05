/**
 * Linux 系统代理：GNOME gsettings（org.gnome.system.proxy）。
 * 非 GNOME 桌面环境会静默失败，UI 上会显示"不受支持"。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemProxyState } from '@teyvat-arkhon/shared'
import type { PlatformSystemProxy } from '.'

const execFileAsync = promisify(execFile)

export class LinuxSystemProxy implements PlatformSystemProxy {
  async read(): Promise<SystemProxyState> {
    try {
      const { stdout } = await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy', 'mode'])
      const mode = stdout.trim().replace(/^'|'$/g, '')
      return { enabled: mode === 'manual', http: mode === 'manual' ? '127.0.0.1' : undefined }
    } catch {
      return { enabled: false }
    }
  }

  async apply(enabled: boolean, httpPort: number): Promise<SystemProxyState> {
    try {
      if (enabled) {
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'])
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1'])
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(httpPort)])
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1'])
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(httpPort)])
        await execFileAsync('gsettings', [
          'set',
          'org.gnome.system.proxy',
          'ignore-hosts',
          "['localhost', '127.0.0.0/8', '::1', '192.168.*']"
        ])
        // GNOME 3/4 下 socks 走 host 复用
        const { stdout } = await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy.socks', 'host'])
        if (stdout.trim().replace(/^'|'$/g, '') === '') {
          await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', '127.0.0.1'])
          await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', String(httpPort)])
        }
      } else {
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'])
      }
      return { enabled, http: enabled ? `127.0.0.1:${httpPort}` : undefined }
    } catch (e) {
      throw new Error(`当前桌面环境不支持 gsettings 系统代理设置: ${(e as Error).message}`)
    }
  }
}