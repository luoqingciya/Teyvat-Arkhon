import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { CoreService } from '@teyvat-arkhon/core-bridge'
import { createIpc } from './ipc'
import { createNetChecker } from './net-check'
import { createSystemProxyController } from './system-proxy'
import { createServiceManager } from './system-service'
import { createLoopbackController } from './system-loopback'
import { createSubscriptionSync } from './subscription-sync'
import { createTrafficMonitor, type TrafficMonitor } from './traffic-monitor'
import { setupAutoUpdater } from './updater'
import { bootstrapDataDir } from './paths'

// 数据目录策略（须在 ready 前确定）：默认便携时数据跟随运行目录
const dataLayout = bootstrapDataDir(app)
// Windows 任务栏图标/通知需绑定 AppUserModelID（与 electron-builder appId 一致）
if (process.platform === 'win32') app.setAppUserModelId('com.teyvat.arkhon')
console.log(
  `[teyvat-arkhon] 运行数据目录: ${dataLayout.dataDir}（${dataLayout.portable ? '便携模式' : '系统用户目录'}）`
)

let service: CoreService | null = null
let mainWindow: BrowserWindow | null = null
let trafficMonitor: TrafficMonitor | null = null

/** arkhon 内核可执行文件名（示例: arkhon-windows-x64.exe / arkhon-darwin-arm64 / arkhon-linux-x64） */
export function coreFileName(): string {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return `arkhon-${process.platform}-${process.arch}${suffix}`
}

/** 内核资源目录：开发期为仓库 resources/arkhon-core，打包后为 process.resourcesPath/arkhon-core */
export function coreResourcesDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'arkhon-core')
  return join(app.getAppPath(), 'resources', 'arkhon-core')
}

/** mihomo 默认数据目录（与 mihomo constant.Path 取值一致） */
function mihomoDataDir(): string {
  const home = os.homedir()
  const defaultDir = join(home, '.config', 'mihomo')
  const xdg = process.env['XDG_CONFIG_HOME']
  return xdg ? join(xdg, 'mihomo') : defaultDir
}

/** 将 resources/arkhon-core 中的 geo 数据播种到 mihomo 数据目录（缺失时才复制） */
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

// ---------- 订阅自动更新开关（持久化到 userData/settings.json） ----------
function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readAutoRefresh(): boolean {
  try {
    const j = JSON.parse(readFileSync(settingsFilePath(), 'utf-8')) as { autoRefresh?: boolean }
    return j.autoRefresh === true
  } catch {
    return false
  }
}

function writeAutoRefresh(enabled: boolean): void {
  try {
    const file = settingsFilePath()
    let j: Record<string, unknown> = {}
    try {
      j = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    } catch {
      /* 首次写入 */
    }
    j.autoRefresh = enabled
    writeFileSync(file, JSON.stringify(j, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[teyvat-arkhon] 保存订阅自动更新设置失败:', (e as Error).message)
  }
}

// ---------- 订阅排除关键词（持久化到 settings.json，导入/刷新时过滤节点） ----------

function readExcludeKeywords(): string[] {
  try {
    const j = JSON.parse(readFileSync(settingsFilePath(), 'utf-8')) as { excludeKeywords?: string[] }
    return Array.isArray(j.excludeKeywords) ? j.excludeKeywords.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeExcludeKeywords(keywords: string[]): void {
  try {
    const file = settingsFilePath()
    let j: Record<string, unknown> = {}
    try {
      j = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    } catch {
      /* 首次写入 */
    }
    j.excludeKeywords = keywords
    writeFileSync(file, JSON.stringify(j, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[teyvat-arkhon] 保存订阅排除关键词失败:', (e as Error).message)
  }
}

// ---------- 系统托盘 ----------
/** 应用图标：打包后取自 resources/icon.png（extraResources 复制），开发期用 build/icon.png */
function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
}

let tray: Tray | null = null
let isQuitting = false

/** 当前主窗口（托盘显示/快速切换用） */
let trayTargetWin: BrowserWindow | null = null

/** 重建托盘右键菜单：档案快速切换（勾选当前使用中）+ 显示/退出 */
async function rebuildTrayMenu(): Promise<void> {
  if (!tray || !service) return
  const items: Electron.MenuItemConstructorOptions[] = []
  let profiles: Array<{ id: string; name: string; selected?: boolean }> = []
  try {
    profiles = await service.listProfiles()
  } catch {
    /* 内核/配置异常时降级为仅基础菜单 */
  }
  if (profiles.length) {
    items.push({ label: '快速切换档案', enabled: false })
    for (const p of profiles.slice(0, 12)) {
      items.push({
        label: p.name,
        type: 'radio',
        checked: p.selected === true,
        click: () => {
          void service?.selectProfile(p.id).catch(() => undefined)
          void rebuildTrayMenu()
          // 通知渲染端刷新订阅列表（托盘切换不经过窗口操作）
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('arkhon:profiles-changed')
          }
        }
      })
    }
    items.push({ type: 'separator' })
  }
  items.push({
    label: '显示主窗口',
    click: () => {
      if (trayTargetWin) trayTargetWin.show()
      for (const w of BrowserWindow.getAllWindows()) w.show()
    }
  })
  items.push({ type: 'separator' })
  items.push({ label: '退出', click: () => { isQuitting = true; app.quit() } })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray(win: BrowserWindow): void {
  const icon = nativeImage.createFromPath(appIconPath())
  if (icon.isEmpty()) return
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Teyvat Arkhon')
  trayTargetWin = win
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { win.show(); win.focus() } },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit() } }
    ])
  )
  void rebuildTrayMenu()
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })
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
    // 窗口/任务栏图标（随包分发 resources/icon.png，与托盘同源）
    icon: appIconPath(),
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
  win.on('close', (e) => {
    // 关闭主窗口时最小化到系统托盘；托盘菜单"退出"才真正结束进程
    if (isQuitting) return
    e.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    mainWindow = null
  })
  createTray(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrapService(): Promise<CoreService> {
  const configDir = userDataConfigDir()
  console.log('[teyvat-arkhon] 内核驱动：进程驱动（稳定优先）')

  const svc = new CoreService({
    profilesDir: join(app.getPath('userData'), 'profiles'),
    activeConfigFile: join(configDir, 'config.yaml'),
    excludeKeywords: readExcludeKeywords,
    driver: {
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
    const netChecker = createNetChecker({
      getProxyPort: async () => (await service?.activeHttpPort()) ?? 7890
    })
    const loopback = createLoopbackController()
    const subscriptionSync = createSubscriptionSync({
      refreshAll: () => service!.refreshAllUrlProfiles()
    })
    // 开关持久化 + 订阅定时器联动
    const setAutoRefresh = (enabled: boolean): void => {
      writeAutoRefresh(enabled)
      if (enabled) subscriptionSync.start()
      else subscriptionSync.stop()
    }
    createIpc(
      service,
      systemProxy,
      serviceManager,
      // TUN 前置依赖探测：resources/arkhon-core 或内核工作目录存在 wintun.dll 即为可用
      () =>
        existsSync(join(coreResourcesDir(), 'wintun.dll')) ||
        (existsSync(userDataConfigDir()) && existsSync(join(userDataConfigDir(), 'wintun.dll'))),
      netChecker,
      loopback,
      readAutoRefresh,
      setAutoRefresh,
      readExcludeKeywords,
      writeExcludeKeywords
    )
    // 已开启自动更新的用户：启动即进入定时刷新节奏
    if (readAutoRefresh()) subscriptionSync.start()

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
  // 托盘"退出"或系统退出时放行窗口 close（不再最小化到托盘）
  isQuitting = true
  if (service) {
    e.preventDefault()
    trafficMonitor?.stop()
    await service.stop()
    service = null
    app.exit(0)
  }
})