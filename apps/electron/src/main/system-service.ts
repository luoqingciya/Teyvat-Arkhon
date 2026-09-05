/**
 * Windows 系统服务托管（MVP）：
 * 注册一个独立服务运行 mihomo 内核（进程驱动模式），实现开机自启 + 免 UAC 常驻。
 *
 * 需要管理员权限的操作通过临时脚本 + RunAs 弹窗提权执行；
 * 查询状态（sc query）无需提权，可安全调用。
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type { SystemServiceState } from '@teyvat-arkhon/shared'

const execFileAsync = promisify(execFile)

export const SERVICE_NAME = 'TeyvatArkhonCore'

export interface ServiceManagerOptions {
  /** mihomo 可执行文件绝对路径（服务使用进程驱动） */
  binaryPath: string
  /** 服务工作目录（-d，含 config.yaml） */
  workingDir: string
  /** 当前工作配置绝对路径 */
  configFile: string
}

export class WindowsServiceManager {
  constructor(private readonly opts: ServiceManagerOptions) {}

  /** 查询服务状态（无需管理员权限） */
  async status(): Promise<SystemServiceState> {
    try {
      const { stdout } = await execFileAsync('sc', ['query', SERVICE_NAME])
      const m = stdout.match(/STATE\s*:\s*(\d+)\s+([A-Z_]+)/)
      if (!m) return { name: SERVICE_NAME, state: 'unknown' }
      const code = Number(m[1])
      if (code === 4) return { name: SERVICE_NAME, state: 'running' }
      if (code === 1) return { name: SERVICE_NAME, state: 'stopped' }
      return { name: SERVICE_NAME, state: 'installed' }
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? ''
      const msg = (e as Error).message
      // 1060 = 服务不存在
      if (/1060|not exist|does not exist/.test(msg + stderr)) {
        return { name: SERVICE_NAME, state: 'not-installed' }
      }
      return { name: SERVICE_NAME, state: 'unknown', error: msg }
    }
  }

  /** 安装服务并在成功后启动（提权） */
  async install(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') {
      throw new Error('系统服务托管目前仅支持 Windows')
    }
    const bin = this.opts.binaryPath
    const display = 'Teyvat Arkhon Core (mihomo)'
    const args = [
      'create',
      SERVICE_NAME,
      'binPath=',
      `"${bin}" -d "${this.opts.workingDir}" -f "${this.opts.configFile}"`,
      'start=',
      'auto',
      'DisplayName=',
      display
    ]
    await this.runElevated('sc.exe', args)
    await this.runElevated('sc.exe', ['start', SERVICE_NAME])
    await new Promise((r) => setTimeout(r, 500))
    return this.status()
  }

  /** 停止并删除服务（提权） */
  async uninstall(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') throw new Error('系统服务托管目前仅支持 Windows')
    await this.runElevated('sc.exe', ['stop', SERVICE_NAME]).catch(() => {})
    await new Promise((r) => setTimeout(r, 300))
    await this.runElevated('sc.exe', ['delete', SERVICE_NAME]).catch(() => {})
    return this.status()
  }

  /**
   * 以管理员权限执行命令：写入临时 ps1 脚本后 RunAs 调用，避免命令行引号地狱。
   * 会弹出 UAC 确认框，由用户确认。
   */
  private async runElevated(exe: string, args: string[]): Promise<void> {
    const script = `& '${exe}' ${args
      .map((a) => (a.includes(' ') ? `'${a.replace(/'/g, "''")}'` : `'${a}'`))
      .join(' ')}\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
    const scriptPath = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.ps1`)
    await fs.writeFile(scriptPath, script, 'utf-8')

    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'`],
        { timeout: 60_000 }
      )
    } finally {
      await fs.rm(scriptPath, { force: true }).catch(() => {})
    }
  }
}

export function createServiceManager(opts: ServiceManagerOptions): WindowsServiceManager {
  return new WindowsServiceManager(opts)
}