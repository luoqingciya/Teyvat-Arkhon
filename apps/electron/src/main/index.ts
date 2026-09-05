import { app, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { CoreService } from '@teyvat-arkhon/core-bridge'
import { createIpc } from './ipc'
import { createSystemProxyController } from './system-proxy'
import { createServiceManager } from './system-service'
import { createTrafficMonitor, type TrafficMonitor } from './traffic-monitor'
import { setupAutoUpdater } from './updater'
import { bootstrapDataDir } from './paths'

// 数据目录策略（须在 ready 前确定）：便携模式数据跟随运行目录
const dataLayout = bootstrapDataDir(app)
console.log(
  `[teyvat-arkhon] 运行数据目录: ${dataLayout.dataDir}（${dataLayout.portable ? '便携模式' : '系统用户目录'}）`
)

let service: CoreService | null = null
let mainWindow: BrowserWindow | null = null
let trafficMonitor: TrafficMonitor | null = null

/** mihomo 内核可执行文件名（示例: mihomo-windows-x64.exe / mihomo-darwin-arm64 / mihomo-linux-x64） */
export function coreFileName(): string {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return `mihomo-${process.platform}-${process.arch}${suffix}`
}

/** 内核资源目录：开发期为仓库 resources/core，打包后为 process.resourcesPath/core */
export function coreResourcesDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'core')
  return join(app.getAppPath(), 'resources', 'core')
}

/**
 * 探测 FFI 原生链路是否可用：需要 libmihomo 共享库 + 原生绑定 .node 同时存在。
 * 不具备时由调用方回退到进程驱动。
 */
function detectFfi(): { libPath?: string; bindingPath?: string } {
  const libPath = join(coreResourcesDir(), 'libmihomo.dll')
  if (!existsSync(libPath)) return {}
  const bindingPath = app.isPackaged
    ? join(process.resourcesPath, 'core', 'mihomo_binding.node')
    : join(app.getAppPath(), '..', '..', 'packages', 'native', 'bin', 'mihomo_binding.node')
  if (!existsSync(bindingPath)) return {}
  return { libPath, bindingPath }
}

/** mihomo 默认数据目录（与 mihomo constant.Path 取值一致） */
function mihomoDataDir(): string {
  const home = os.homedir()
  const defaultDir = join(home, '.config', 'mihomo')
  const xdg = process.env['XDG_CONFIG_HOME']
  return xdg ? join(xdg, 'mihomo') : defaultDir
}

/** 将 resources/core 中的 geo 数据播种到 mihomo 数据目录（缺失时才复制） */
function seedGeoData(): void {
  try {
    const targetDir = mihomoDataDir()
    mkdirSync(targetDir, { recursive: true })
    for (const name of ['geoip.dat', 'geosite.dat', 'geoip.metadb']) {
      const src = join(coreResourcesDir(), name)
      const dest = join(targetDir, name)
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest)
        console.log('[teyvat-arkhon] geo 数据已播种: %s', dest)
      }
    }
    // wintun 驱动播种到内核工作目录（TUN 模式加载用）
    const wintunSrc = join(coreResourcesDir(), 'wintun.dll')
    if (existsSync(wintunSrc)) {
      const workDir = userDataConfigDir()
      mkdirSync(workDir, { recursive: true })
      const wintunDest = join(workDir, 'wintun.dll')
      if (!existsSync(wintunDest)) {
        copyFileSync(wintunSrc, wintunDest)
        console.log('[teyvat-arkhon] wintun 驱动已播种: %s', wintunDest)
      }
    }
  } catch (e) {
    console.warn('[teyvat-arkhon] 运行时文件播种失败（可忽略）:', (e as Error).message)
  }
}

function userDataConfigDir(): string {
  return join(app.getPath('userData'), 'config')
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    // Windows 窗口/任务栏图标（打包安装后改用 exe 内置图标，此处路径不存在自动忽略）
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    title: 'Teyvat Arkhon',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    win.show()
    win.maximize()
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrapService(): Promise<CoreService> {
  const configDir = userDataConfigDir()
  const ffi = detectFfi()

  if (ffi.libPath) {
    console.log('[teyvat-arkhon] FFI 驱动可用: libmihomo=%s binding=%s', ffi.libPath, ffi.bindingPath)
  } else {
    console.log('[teyvat-arkhon] 未探测到 FFI 原生链路，回退到进程驱动')
  }

  const svc = new CoreService({
    profilesDir: join(app.getPath('userData'), 'profiles'),
    activeConfigFile: join(configDir, 'config.yaml'),
    driver: ffi.libPath
      ? { mode: 'ffi', options: { libPath: ffi.libPath, bindingPath: ffi.bindingPath } }
      : {
          mode: 'process',
          options: {
            binaryPath: join(coreResourcesDir(), coreFileName()),
            workingDir: configDir,
            externalController: '127.0.0.1:9090',
            secret: ''
          }
        }
  })
  await svc.init()
  return svc
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    seedGeoData()
    service = await bootstrapService()
    const systemProxy = createSystemProxyController({
      isCoreRunning: () => (service?.status().state ?? 'stopped') === 'running',
      getHttpPort: async () => (await service?.activeHttpPort()) ?? 7890
    })
    const serviceManager = createServiceManager({
      binaryPath: join(coreResourcesDir(), coreFileName()),
      workingDir: userDataConfigDir(),
      configFile: join(userDataConfigDir(), 'config.yaml')
    })
    createIpc(service, systemProxy, serviceManager)

    trafficMonitor = createTrafficMonitor(() => service)
    trafficMonitor.start()

    setupAutoUpdater()

    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (e) => {
  if (service) {
    e.preventDefault()
    trafficMonitor?.stop()
    await service.stop()
    service = null
    app.exit(0)
  }
})