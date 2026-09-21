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
      const stdout = (e as { stdout?: string }).stdout ?? ''
      const stderr = (e as { stderr?: string }).stderr ?? ''
      const msg = (e as Error).message
      // 1060 = 服务不存在。注意：sc 把「服务并未安装」错误输出到 stdout，
      // 且以非零退出码退出（Error.message 不含错误细节），必须把 stdout 纳入判断，
      // 否则「未安装」会被误报为「未知」+ 红错。
      if (/1060|not exist|does not exist/.test(msg + stdout + stderr)) {
        return { name: SERVICE_NAME, state: 'not-installed' }
      }
      return { name: SERVICE_NAME, state: 'unknown', error: msg }
    }
  }

  /** 安装服务并在成功后启动（单次提权） */
  async install(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') {
      throw new Error('系统服务托管目前仅支持 Windows')
    }
    const bin = this.opts.binaryPath
    const logFile = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.log`)
    try {
      await this.runElevated(logFile, [
        `& 'sc.exe' create '${SERVICE_NAME}' 'binPath=' '"${bin}" -d "${this.opts.workingDir}" -f "${this.opts.configFile}"' 'start=' 'auto' 'DisplayName=' 'Teyvat Arkhon Core (mihomo)'`,
        `& 'sc.exe' start '${SERVICE_NAME}'`
      ])
      await new Promise((r) => setTimeout(r, 600))
      return this.status()
    } finally {
      await fs.rm(logFile, { force: true }).catch(() => {})
    }
  }

  /** 停止并删除服务（单次提权） */
  async uninstall(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') throw new Error('系统服务托管目前仅支持 Windows')
    const logFile = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.log`)
    try {
      await this.runElevated(logFile, [
        `& 'sc.exe' stop '${SERVICE_NAME}' 2>&1 | Out-Null; sc.exe delete '${SERVICE_NAME}'`
      ])
      await new Promise((r) => setTimeout(r, 400))
      return this.status()
    } finally {
      await fs.rm(logFile, { force: true }).catch(() => {})
    }
  }

  /**
   * 以管理员权限执行一组命令（单次 UAC）。
   * 把每条的输出 + 退出码写入 logFile 回传，供调用方拿到 sc 的真实错误——
   * Start-Process -Verb RunAs 返回后无法直接取到被提权进程的退出码，
   * 必须借助日志文件判断 command 是否真正成功，否则失败会被静默吞掉。
   */
  private async runElevated(logFile: string, commands: string[]): Promise<void> {
    const body = commands
      .map(
        (c) =>
          `${c} 2>&1 | Out-File -Append -Encoding utf8 -FilePath '${logFile}'\n` +
          `if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Out-File -Append -Encoding utf8 -FilePath '${logFile}' }`
      )
      .join('\n')
    const script =
      `$ErrorActionPreference = 'Continue'\n` +
      `Set-Content -Encoding utf8 -Path '${logFile}' -Value 'BEGIN'\n${body}\n`

    const scriptPath = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.ps1`)
    await fs.writeFile(scriptPath, script, 'utf-8')

    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'`],
        { timeout: 120_000 }
      )
    } finally {
      await fs.rm(scriptPath, { force: true }).catch(() => {})
    }

    const log = await fs.readFile(logFile, 'utf-8').catch(() => '')
    const m = log.match(/EXIT=([0-9]+)/)
    if (m) {
      throw new Error(`服务命令执行失败（退出码 ${m[1]}）：\n${log.split('\n').filter(Boolean).join(' | ')}`)
    }
    if (log.includes('EXIT_ERR')) {
      throw new Error(`服务命令执行异常：\n${log}`)
    }
  }
}

export function createServiceManager(opts: ServiceManagerOptions): WindowsServiceManager {
  return new WindowsServiceManager(opts)
}