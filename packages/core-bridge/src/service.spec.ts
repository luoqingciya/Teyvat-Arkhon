/**
 * CoreService 稳定性守护单测。
 *
 * 退避重启（2s→4s→8s→16s→30s，上限 5 次，稳定 60s 重置）与假死 watchdog
 * 是本项目最复杂的纯逻辑，此前只能靠 E2E 覆盖。这里通过 driverFactory 注入
 * 假驱动 + vitest 假计时器，做确定性验证。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  ConnectionInfo,
  DelayResult,
  MihomoVersion,
  ProxyItem,
  ProxyMode,
  RuleInfo
} from '@teyvat-arkhon/shared'
import { CoreService, type CoreDriverConfig, type DriverHooks } from './service'
import type { CoreDriver } from './driver'

/** 最小可用工作配置（parseAndValidate 要求有 proxies 或监听端口） */
const ACTIVE_CONFIG = `mixed-port: 7890
external-controller: 127.0.0.1:9090
mode: rule
proxies:
  - name: "HK-01"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-256-gcm
    password: "secret"
`

const PROCESS_DRIVER: CoreDriverConfig = {
  mode: 'process',
  options: {
    binaryPath: '/nonexistent/arkhon',
    workingDir: '/tmp',
    externalController: '127.0.0.1:9090',
    secret: ''
  }
}

/**
 * 假驱动：只实现状态机关心的部分，行为完全可控。
 * - emitExit()：模拟子进程意外退出（触发 hooks.onExit）
 * - startError / probeFails：模拟重启失败 / 假死
 */
class FakeDriver implements CoreDriver {
  startCalls = 0
  closeCalls = 0
  /** 置为 Error 时 start() 抛错，模拟重启失败 */
  startError: Error | null = null
  /** 置为 true 时 getVersion() 抛错，模拟 REST 无响应（假死） */
  probeFails = false
  /** close() 是否连带模拟子进程退出 */
  emitExitOnClose = true
  version: MihomoVersion = { version: 'v1.19.30', meta: true }

  constructor(
    readonly kind: 'process' | 'service',
    private readonly hooks: DriverHooks
  ) {}

  async start(): Promise<void> {
    this.startCalls++
    if (this.startError) throw this.startError
  }

  async stop(): Promise<void> {}

  async reload(): Promise<void> {}

  async getVersion(): Promise<MihomoVersion> {
    if (this.probeFails) throw new Error('REST 无响应')
    return this.version
  }

  async setMode(): Promise<void> {}

  async getMode(): Promise<ProxyMode | undefined> {
    return 'rule'
  }

  getLogs(): string[] {
    return []
  }

  async getProxies(): Promise<ProxyItem[]> {
    return []
  }

  async getRules(): Promise<RuleInfo[]> {
    return []
  }

  async selectProxy(): Promise<void> {}

  async testDelay(): Promise<DelayResult> {
    return { node: 'x', delay: -1 }
  }

  async listDelaySnapshot(): Promise<Record<string, number | null>> {
    return {}
  }

  async getConnections(): Promise<{
    downloadTotal: number
    uploadTotal: number
    connections: ConnectionInfo[]
  }> {
    return { downloadTotal: 0, uploadTotal: 0, connections: [] }
  }

  async closeConnection(): Promise<void> {}

  async closeAllConnections(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCalls++
    if (this.emitExitOnClose) this.emitExit(0)
  }

  /** 模拟子进程意外退出 */
  emitExit(code: number | null = 1): void {
    this.hooks.onExit(code, null)
  }

  /** 模拟内核日志批量推送 */
  emitLogs(lines: string[]): void {
    this.hooks.onLogs(lines)
  }
}

/** 退避间隔（与 service.ts 内的 RESTART_BACKOFF_MS 一致，用于断言时序） */
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000]

describe('CoreService 稳定性守护', () => {
  let dir: string
  let activeFile: string
  let driver: FakeDriver

  async function createService(): Promise<CoreService> {
    const svc = new CoreService({
      profilesDir: path.join(dir, 'profiles'),
      activeConfigFile: activeFile,
      driver: PROCESS_DRIVER,
      driverFactory: (cfg, hooks) => {
        driver = new FakeDriver(cfg.mode, hooks)
        return driver
      }
    })
    // EventEmitter 对 'error' 事件有特殊语义：无监听者时 emit 会直接抛出，
    // 而生产环境 ipc.ts 始终挂着监听（service.on('error', ...)）。
    // 此处对齐生产装配，避免退避链路在 emit 处中断。
    svc.on('error', () => undefined)
    await svc.init()
    return svc
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arkhon-svc-'))
    activeFile = path.join(dir, 'config', 'config.yaml')
    await fs.mkdir(path.dirname(activeFile), { recursive: true })
    await fs.writeFile(activeFile, ACTIVE_CONFIG, 'utf-8')
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('未导入订阅时启动抛错，状态保持 stopped', async () => {
    await fs.rm(activeFile, { force: true })
    const svc = await createService()

    await expect(svc.start()).rejects.toThrow(/还未导入任何订阅配置/)
    expect(svc.status().state).toBe('stopped')
  })

  it('启动成功：状态经 starting → running，并同步内核版本', async () => {
    const svc = await createService()
    const states: string[] = []
    svc.on('state-change', (st) => states.push(st.state))

    const status = await svc.start()

    expect(status.state).toBe('running')
    expect(status.version?.version).toBe('v1.19.30')
    expect(status.driver).toBe('process')
    expect(driver.startCalls).toBe(1)
    expect(states).toContain('starting')
    expect(states).toContain('running')

    await svc.stop()
  })

  it('驱动日志经 core-logs 事件批量转发', async () => {
    const svc = await createService()
    await svc.start()

    const batches: string[][] = []
    svc.on('core-logs', (lines: string[]) => batches.push(lines))
    driver.emitLogs(['line-1', 'line-2'])

    expect(batches).toEqual([['line-1', 'line-2']])
    await svc.stop()
  })

  it('意外退出按 2s/4s/8s/16s/30s 逐级退避重启', async () => {
    const svc = await createService()
    await svc.start()
    expect(driver.startCalls).toBe(1)

    for (let i = 0; i < BACKOFF_MS.length; i++) {
      driver.emitExit(1)
      expect(svc.status().state).toBe('starting')

      // 退避未到点：不应重启
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[i] - 1)
      expect(driver.startCalls).toBe(i + 1)

      // 到达退避点：重启一次并回到 running
      await vi.advanceTimersByTimeAsync(1)
      expect(driver.startCalls).toBe(i + 2)
      expect(svc.status().state).toBe('running')
    }

    await svc.stop()
  })

  it('连续 5 次重启后仍失败则进入 error 且不再重试', async () => {
    const svc = await createService()
    await svc.start()
    const errors: string[] = []
    svc.on('error', (e: unknown) => errors.push((e as Error).message))

    for (const delay of BACKOFF_MS) {
      driver.emitExit(1)
      await vi.advanceTimersByTimeAsync(delay)
    }
    // 首次启动 1 次 + 5 次退避重启
    expect(driver.startCalls).toBe(6)

    // 第 6 次意外退出：已达上限，停止重试
    driver.emitExit(1)
    expect(svc.status().state).toBe('error')
    expect(errors.some((m) => m.includes('自动重启 5 次仍失败'))).toBe(true)

    // 再推进时间也不应再重启
    await vi.advanceTimersByTimeAsync(120_000)
    expect(driver.startCalls).toBe(6)

    await svc.stop()
  })

  it('稳定运行满 60s 后退避计数归零（重新从最短间隔开始）', async () => {
    const svc = await createService()
    await svc.start()

    // 第一次意外退出 → 2s 后重启，attempts=1
    driver.emitExit(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(driver.startCalls).toBe(2)

    // 稳定运行满 60s → 计数重置
    await vi.advanceTimersByTimeAsync(60_000)

    // 再次意外退出：退避重新从 2s 起算（若未重置则应为 4s）
    driver.emitExit(1)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(driver.startCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(driver.startCalls).toBe(3)

    await svc.stop()
  })

  it('重启失败继续退避，直到耗尽次数', async () => {
    const svc = await createService()
    await svc.start()
    const errors: string[] = []
    svc.on('error', (e: unknown) => errors.push((e as Error).message))

    // 首次启动成功后，令后续 start() 一律失败
    driver.startError = new Error('spawn ENOENT')

    driver.emitExit(1)
    await vi.advanceTimersByTimeAsync(2_000)
    // start 失败：startCalls 已计数，但状态仍为 starting（等待下一轮退避）
    expect(driver.startCalls).toBe(2)
    expect(svc.status().state).toBe('starting')
    expect(errors.some((m) => m.includes('spawn ENOENT'))).toBe(true)

    await svc.stop()
  })

  it('主动停止不触发自动重启', async () => {
    const svc = await createService()
    await svc.start()

    await svc.stop()
    // stop() 内部 close() 模拟了子进程退出；intentionalStop 已置位，不应重启
    await vi.advanceTimersByTimeAsync(60_000)

    expect(driver.startCalls).toBe(1)
    expect(svc.status().state).toBe('stopped')
  })

  it('连续 3 次探测失败判定假死并强制重启内核', async () => {
    const svc = await createService()
    await svc.start()
    const errors: string[] = []
    svc.on('error', (e: unknown) => errors.push((e as Error).message))

    driver.probeFails = true

    await vi.advanceTimersByTimeAsync(30_000)
    expect(driver.closeCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(driver.closeCalls).toBe(0)

    // 第 3 次失败：判定假死，强制 close 内核
    await vi.advanceTimersByTimeAsync(30_000)
    expect(driver.closeCalls).toBe(1)
    expect(errors.some((m) => m.includes('疑似假死'))).toBe(true)

    await svc.stop()
  })

  it('休眠唤醒探测失败同样计入假死判定', async () => {
    const svc = await createService()
    await svc.start()
    driver.probeFails = true

    expect(await svc.probeHealth()).toBe(false)
    expect(await svc.probeHealth()).toBe(false)
    expect(driver.closeCalls).toBe(0)

    expect(await svc.probeHealth()).toBe(false)
    expect(driver.closeCalls).toBe(1)

    await svc.stop()
  })

  it('切换驱动配置：同模式为空操作，换模式则先停后启并重建驱动', async () => {
    const svc = await createService()
    await svc.start()
    const firstDriver = driver
    expect(firstDriver.startCalls).toBe(1)

    // 同模式：直接返回，不重启
    const same = await svc.setDriverConfig(PROCESS_DRIVER)
    expect(same.driver).toBe('process')
    expect(firstDriver.startCalls).toBe(1)

    // 换模式：先停旧驱动，再经工厂创建新驱动
    const switched = await svc.setDriverConfig({
      mode: 'service',
      options: { externalController: '127.0.0.1:9090', secret: '' }
    })
    expect(switched.driver).toBe('service')
    expect(switched.state).toBe('running')
    expect(firstDriver.closeCalls).toBeGreaterThanOrEqual(1)
    expect(driver).not.toBe(firstDriver)
    expect(driver.startCalls).toBe(1)

    await svc.stop()
  })
})
