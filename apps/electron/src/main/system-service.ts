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
import { TextDecoder } from 'node:util'
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
      // binPath 值内嵌引号必须写成 \"（sc.exe 的转义形式），且整体再包一层引号。
      // 经 .bat/cmd 执行（而非 PowerShell）才能把这些引号原样传给 sc，
      // 否则 PowerShell 会把内嵌引号二次转义 → sc 报 1639 参数错误。
      const binPath = `\\"${bin}\\" -d \\"${this.opts.workingDir}\\" -f \\"${this.opts.configFile}\\"`
      await this.runElevated(logFile, [
        `sc create ${SERVICE_NAME} binPath= "${binPath}" start= auto DisplayName= "Teyvat Arkhon Core (mihomo)"`,
        `sc start ${SERVICE_NAME}`
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
        `sc stop ${SERVICE_NAME} >nul 2>&1 & sc delete ${SERVICE_NAME}`
      ])
      await new Promise((r) => setTimeout(r, 400))
      return this.status()
    } finally {
      await fs.rm(logFile, { force: true }).catch(() => {})
    }
  }

  /**
   * 以管理员权限执行一组命令（单次 UAC）。
   * 生成临时 .bat 由 cmd 执行：cmd 不对参数内的引号做二次转义，sc 才能正确解析
   * binPath= "\"..\" -d .." 这样的转义引号形式（PowerShell 版本会把它破坏导致 sc 1639）。
   * 每条命令的输出与退出码写入 logFile 回传（Start-Process -Verb RunAs 拿不到被提权进程的
   * 退出码，必须靠日志文件判断真实成败）。日志为系统 ANSI(GBK)，读取时转 utf-8 避免乱码。
   */
  private async runElevated(logFile: string, commands: string[]): Promise<void> {
    const lines = ['@echo off', 'setlocal EnableExtensions', `> "${logFile}" echo BEGIN`]
    for (const c of commands) {
      lines.push(
        `${c} 1>> "${logFile}" 2>&1 1>&2`,
        `if errorlevel 1 echo EXIT=%errorlevel% 1>> "${logFile}" 2>&1`
      )
      lines.push(`echo --- 1>> "${logFile}" 2>&1`)
    }
    const batPath = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.bat`)
    // .bat 由 cmd 按系统 ANSI 代码页解析；内容全英文保证兼容（中文 OEM 936）
    await fs.writeFile(batPath, lines.join('\r\n'), 'ascii')

    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Start-Process cmd -Verb RunAs -Wait -ArgumentList '/d','/c','"${batPath}"'`],
        { timeout: 120_000 }
      )
    } finally {
      await fs.rm(batPath, { force: true }).catch(() => {})
    }

    const buf = await fs.readFile(logFile).catch(() => Buffer.from(''))
    const text = decodeAnsi(buf)
    const m = text.match(/EXIT=([0-9]+)/)
    if (m) {
      throw new Error(
        `服务命令执行失败（退出码 ${m[1]}）：\n${text.split('\n').filter(Boolean).join(' | ')}`
      )
    }
  }
}

/** sc/cmd 输出为系统 ANSI；按 GBK 解码，读不出来时退回 utf-8 */
function decodeAnsi(buf: Buffer): string {
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

export function createServiceManager(opts: ServiceManagerOptions): WindowsServiceManager {
  return new WindowsServiceManager(opts)
}