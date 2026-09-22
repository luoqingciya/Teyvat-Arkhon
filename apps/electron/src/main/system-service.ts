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
  /** NSSM 宿主绝对路径（随包分发；负责与 SCM 握手并托管普通内核进程） */
  nssmPath: string
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

  /** 安装服务并在成功后启动（单次提权）。用 NSSM 托管内核——内核非服务程序，
   * 直接 sc create 注册后 SCM 等不到握手必然 1053 启动超时，NSSM 解决该问题。 */
  async install(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') {
      throw new Error('系统服务托管目前仅支持 Windows')
    }
    const { nssmPath, binaryPath: bin, workingDir, configFile } = this.opts
    const logFile = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.log`)
    try {
      await this.runElevated(logFile, [
        // 清理可能残留的旧服务（覆盖 1073：服务已存在；容错：不存在时不报错）。
        // 行尾 & ver 把 errorlevel 归零，避免「服务不存在」被下方 if errorlevel 误报。
        `"${nssmPath}" stop ${SERVICE_NAME} >nul 2>&1 & "${nssmPath}" remove ${SERVICE_NAME} confirm >nul 2>&1 & ver >nul`,
        // 注册：NSSM 作为宿主，把内核当普通子进程托管（参数经 nssm 原样存进 ImagePath）
        `"${nssmPath}" install ${SERVICE_NAME} "${bin}" -d "${workingDir}" -f "${configFile}"`,
        // 崩溃自动重启（契合内核稳定性需求；2.24 参数为 AppExit，值 Restart），随后启动
        `"${nssmPath}" set ${SERVICE_NAME} AppExit Restart`,
        `"${nssmPath}" start ${SERVICE_NAME}`
      ])
      await new Promise((r) => setTimeout(r, 800))
      return this.status()
    } finally {
      await fs.rm(logFile, { force: true }).catch(() => {})
    }
  }

  /** 停止并删除服务（单次提权） */
  async uninstall(): Promise<SystemServiceState> {
    if (process.platform !== 'win32') throw new Error('系统服务托管目前仅支持 Windows')
    const { nssmPath } = this.opts
    const logFile = path.join(os.tmpdir(), `arkhon-svc-${Date.now()}.log`)
    try {
      await this.runElevated(logFile, [
        `"${nssmPath}" stop ${SERVICE_NAME} >nul 2>&1 & "${nssmPath}" remove ${SERVICE_NAME} confirm`
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
    const lines = [
      '@echo off',
      'setlocal EnableExtensions',
      `> "${logFile}" echo BEGIN`,
      'echo [teyvat-arkhon] running service operation as admin; this window closes automatically...'
    ]
    for (const c of commands) {
      lines.push(
        `${c} >> "${logFile}" 2>&1`,
        `if errorlevel 1 echo EXIT=%errorlevel% >> "${logFile}" 2>&1`
      )
      lines.push(`echo --- >> "${logFile}" 2>&1`)
    }
    // 强制退出 cmd：否则 Start-Process -Wait 会等到窗口被手动关闭，
    // install() 的状态刷新被阻塞 → 服务已创建但界面仍停留「未安装」。
    lines.push('exit /b 0')
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