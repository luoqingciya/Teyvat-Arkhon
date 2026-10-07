import { app, BrowserWindow, Menu, powerMonitor, shell, Tray, nativeImage } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { CoreService, type CoreDriverConfig } from '@teyvat-arkhon/core-bridge'
import {
  DEFAULT_UI_LANGUAGE,
  isUiLanguage,
  type ProxyMode,
  type UiLanguage
} from '@teyvat-arkhon/shared'
import { createIpc } from './ipc'
import { createNetChecker } from './net-check'
import { createSystemProxyController, type SystemProxyController } from './system-proxy'
import { createServiceManager, type WindowsServiceManager } from './system-service'
import { createLoopbackController } from './system-loopback'
import { createSubscriptionSync } from './subscription-sync'
import { createTrafficMonitor, type TrafficMonitor } from './traffic-monitor'
import { createUpdateManager } from './updater'
import { bootstrapDataDir } from './paths'
import { setMainLanguage, t } from './i18n'
import { getSetting, setSetting } from './settings'

// 数据目录策略（须在 ready 前确定）：默认便携时数据跟随运行目录
const dataLayout = bootstrapDataDir(app)
// Windows 任务栏图标/通知需绑定 AppUserModelID（与 electron-builder appId 一致）
if (process.platform === 'win32') app.setAppUserModelId('com.teyvat.arkhon')
console.log(
  `[teyvat-arkhon] 运行数据目录: ${dataLayout.dataDir}（${dataLayout.portable ? '便携模式' : '系统用户目录'}）`
)

let service: CoreService | null = null
let serviceManager: WindowsServiceManager | null = null
let mainWindow: BrowserWindow | null = null
let trafficMonitor: TrafficMonitor | null = null
/** 系统代理控制器（退出清理用，whenReady 后可用） */
let systemProxy: SystemProxyController | null = null
/** 本会话内由本应用成功应用的系统代理期望态（null=未操作过；退出清理仅处理 true） */
let proxyExpected: boolean | null = null

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

/** NSSM 服务宿主路径：打包后随 extraResources 分发，开发期用仓库 build/nssm */
export function nssmPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'nssm', 'nssm.exe')
  return join(app.getAppPath(), 'build', 'nssm', 'nssm.exe')
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

// ---------- 设置持久化（统一走 settings 模块，落盘到 userData/settings.json） ----------

/** 订阅自动更新开关（默认关闭） */
function readAutoRefresh(): boolean {
  return getSetting<boolean>('autoRefresh', false) === true
}

function writeAutoRefresh(enabled: boolean): void {
  setSetting('autoRefresh', enabled)
}

/** 订阅排除关键词（导入/刷新时过滤节点） */
function readExcludeKeywords(): string[] {
  const v = getSetting<unknown>('excludeKeywords', [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function writeExcludeKeywords(keywords: string[]): void {
  setSetting('excludeKeywords', keywords)
}

/** 自动检查更新（默认开启） */
function readAutoUpdate(): boolean {
  return getSetting<boolean>('autoUpdate', true) !== false
}

function writeAutoUpdate(enabled: boolean): void {
  setSetting('autoUpdate', enabled)
}

/**
 * 界面语言。渲染端启动与切换语言时经 IPC 同步过来；
 * 主进程据此产出托盘菜单、原生对话框与网络自检结果文案。
 */
function readLanguage(): UiLanguage {
  const v = getSetting<unknown>('language', undefined)
  return isUiLanguage(v) ? v : DEFAULT_UI_LANGUAGE
}

function writeLanguage(lang: UiLanguage): void {
  setSetting('language', lang)
}

/** 开机自启（系统登录项，独立于 Windows 服务托管） */
function readAutoStart(): boolean {
  return getSetting<boolean>('autoStart', false) === true
}

/**
 * 设置开机自启。
 * - win32/darwin：electron app.setLoginItemSettings（注册表/LaunchAgent）
 * - linux：XDG autostart .desktop（handled by login item API in newer Electron, fallback 无操作）
 * 失败不抛错，返回当前实际状态。
 */
function applyAutoStart(enabled: boolean): boolean {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true
      })
    }
    setSetting('autoStart', enabled)
    return true
  } catch (e) {
    console.warn('[teyvat-arkhon] 设置开机自启失败:', (e as Error).message)
    return false
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

/** 托盘增强所需的控制器（系统代理/模式切换），createTray 时注入 */
let traySystemProxy: SystemProxyController | null = null

/** 内核模式显示名（托盘菜单文案，跟随主进程语言） */
function modeLabel(mode: ProxyMode): string {
  return mode === 'rule' ? t('tray.mode.rule') : mode === 'global' ? t('tray.mode.global') : t('tray.mode.direct')
}

/** 重建托盘右键菜单：档案快速切换（勾选当前使用中）+ 系统代理开关 + 模式切换 + 显示/退出 */
async function rebuildTrayMenu(): Promise<void> {
  if (!tray || !service) return
  const items: Electron.MenuItemConstructorOptions[] = []
  let profiles: Array<{ id: string; name: string; selected?: boolean }> = []
  try {
    profiles = await service.listProfiles()
  } catch {
    /* 内核/配置异常时降级为仅基础菜单 */
  }
  // -------- 代理模式（勾选当前） --------
  let currentMode: ProxyMode | undefined
  try {
    currentMode = await service.getMode()
  } catch {
    /* 未运行 */
  }
  items.push({ label: t('tray.proxyMode'), enabled: false })
  for (const m of ['rule', 'global', 'direct'] as ProxyMode[]) {
    items.push({
      label: modeLabel(m),
      type: 'radio',
      checked: currentMode === m,
      click: () => {
        if (!service) return
        void service.setMode(m).catch(() => undefined)
      }
    })
  }
  items.push({ type: 'separator' })
  // -------- 系统代理开关 --------
  let sysProxyOn = false
  try {
    sysProxyOn = (await traySystemProxy?.read())?.enabled === true
  } catch {
    /* 读取失败视为关闭 */
  }
  items.push({
    label: sysProxyOn ? t('tray.systemProxy.on') : t('tray.systemProxy.off'),
    type: 'checkbox',
    checked: sysProxyOn,
    click: (item) => {
      if (!traySystemProxy) return
      void traySystemProxy
        .set(item.checked)
        .then(() => rebuildTrayMenu())
        .catch(() => undefined)
    }
  })
  items.push({ type: 'separator' })
  if (profiles.length) {
    items.push({ label: t('tray.quickSwitch'), enabled: false })
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
    label: t('tray.show'),
    click: () => {
      if (trayTargetWin) trayTargetWin.show()
      for (const w of BrowserWindow.getAllWindows()) w.show()
    }
  })
  items.push({ type: 'separator' })
  items.push({ label: t('tray.quit'), click: () => { isQuitting = true; app.quit() } })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray(win: BrowserWindow, systemProxy: SystemProxyController): void {
  const icon = nativeImage.createFromPath(appIconPath())
  if (icon.isEmpty()) return
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Teyvat Arkhon')
  trayTargetWin = win
  traySystemProxy = systemProxy
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('tray.show'), click: () => { win.show(); win.focus() } },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => { isQuitting = true; app.quit() } }
    ])
  )
  void rebuildTrayMenu()
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })
}
async function createWindow(systemProxy: SystemProxyController): Promise<void> {
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
      // 渲染进程沙箱：preload 仅用 contextBridge/ipcRenderer（产物为 CJS、只 require electron），
      // 不触碰 Node 内置模块，故可开启以获得 OS 级渲染进程隔离。
      sandbox: true
    }
  })
  mainWindow = win

  // 外链一律交给系统浏览器：应用窗口内没有返回入口，被导航走只能重启。
  // 同源导航（开发期 dev server 的 HMR 重载、生产期 file://）放行。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    let target: URL
    let current: URL
    try {
      target = new URL(url)
      current = new URL(win.webContents.getURL())
    } catch {
      return
    }
    if (target.protocol === current.protocol && target.origin === current.origin) return
    e.preventDefault()
    if (target.protocol === 'http:' || target.protocol === 'https:') void shell.openExternal(url)
  })

  win.once('ready-to-show', () => {
    win.show()
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
  createTray(win, systemProxy)

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrapService(): Promise<CoreService> {
  const configDir = userDataConfigDir()
  // 驱动配置按系统服务状态决定：服务托管运行中则接管服务内核（不再二次 spawn），
  // 否则常规进程驱动（应用内启动内核实例）。
  const svcRunning = serviceManager ? (await serviceManager.status()).state === 'running' : false
  const driver: CoreDriverConfig = svcRunning
    ? serviceManager!.getServiceDriverConfig()
    : serviceManager!.getProcessDriverConfig()
  console.log(`[teyvat-arkhon] 内核驱动：${svcRunning ? '系统服务接管（service）' : '进程驱动（process）'}`)

  const svc = new CoreService({
    profilesDir: join(app.getPath('userData'), 'profiles'),
    activeConfigFile: join(configDir, 'config.yaml'),
    excludeKeywords: readExcludeKeywords,
    geodataDirs: [mihomoDataDir(), coreResourcesDir()],
    driver
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
    // 主进程语言须在创建托盘/窗口之前就位（托盘文案在窗口加载前即已生成）
    setMainLanguage(readLanguage())
    seedGeoData()
    // 系统服务托管管理器（须在 bootstrapService 之前就位：后者按服务状态选择驱动）
    serviceManager = createServiceManager({
      binaryPath: join(coreResourcesDir(), coreFileName()),
      workingDir: userDataConfigDir(),
      configFile: join(userDataConfigDir(), 'config.yaml'),
      nssmPath: nssmPath()
    })
    service = await bootstrapService()
    // 系统代理守护：记录本会话内由本应用成功应用的期望态；
    // 被第三方程序（VPN/安全软件）改掉时自动恢复并通知（仅守护"开启"态）
    systemProxy = createSystemProxyController({
      isCoreRunning: () => (service?.status().state ?? 'stopped') === 'running',
      getHttpPort: async () => (await service?.activeHttpPort()) ?? 7890,
      onApplied: (enabled) => {
        proxyExpected = enabled
      }
    })
    // 模块级 controller 已就位，局部非空绑定供后续引用
    const sysProxy = systemProxy
    setInterval(() => {
      void (async () => {
        if (proxyExpected !== true) return
        if ((service?.status().state ?? 'stopped') !== 'running') return
        try {
          const actual = await sysProxy.read()
          if (actual.enabled === true) return
          await sysProxy.set(true)
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('arkhon:error', t('tray.sysProxyRestored'))
          }
        } catch {
          /* 本轮读取/恢复失败，下轮重试 */
        }
      })()
    }, 10_000).unref()
    // 休眠唤醒后立即探测内核健康（唤醒瞬间 REST 可能短暂不可用，连续失败会触发自动重启）
    powerMonitor.on('resume', () => {
      void service?.probeHealth()
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
    // 应用更新管理：状态广播到渲染进程（设置页展示/手动检查/安装）
    const updateManager = createUpdateManager({ autoEnabled: readAutoUpdate() })
    const setAutoUpdate = (enabled: boolean): boolean => {
      const ok = updateManager.setAutoEnabled(enabled)
      writeAutoUpdate(enabled)
      return ok
    }
    // 语言切换（渲染端设置页触发）：持久化 + 重建托盘菜单使文案即时跟随
    const setLanguage = (lang: UiLanguage): UiLanguage => {
      const applied = setMainLanguage(lang)
      writeLanguage(applied)
      void rebuildTrayMenu()
      return applied
    }
    // 流量监控先于 IPC 就位：连接明细订阅处理器依赖该实例
    const monitor = createTrafficMonitor(() => service)
    trafficMonitor = monitor
    createIpc({
      service,
      systemProxy: sysProxy,
      serviceManager,
      // TUN 前置依赖探测：resources/arkhon-core 或内核工作目录存在 wintun.dll 即为可用
      tunPrereq: () =>
        existsSync(join(coreResourcesDir(), 'wintun.dll')) ||
        (existsSync(userDataConfigDir()) && existsSync(join(userDataConfigDir(), 'wintun.dll'))),
      netChecker,
      loopback,
      getAutoRefresh: readAutoRefresh,
      setAutoRefresh,
      getExcludeKeywords: readExcludeKeywords,
      setExcludeKeywords: writeExcludeKeywords,
      getAutoStart: readAutoStart,
      setAutoStart: applyAutoStart,
      updateManager,
      setAutoUpdate,
      setLanguage,
      trafficMonitor: monitor
    })
    // 已开启自动更新的用户：启动即进入定时刷新节奏
    if (readAutoRefresh()) subscriptionSync.start()

    monitor.start()

    // 启动稍后自动检查一次更新（未勾选自动检查时仍可到设置页手动检查）
    if (readAutoUpdate()) {
      setTimeout(() => void updateManager.checkNow(), 10_000)
    }

    await createWindow(sysProxy)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(sysProxy)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** 退出时等待内核停止的上限；超时即强制结束，避免内核不响应导致进程无法退出 */
const SHUTDOWN_TIMEOUT_MS = 3_000

app.on('before-quit', async (e) => {
  // 托盘"退出"或系统退出时放行窗口 close（不再最小化到托盘）
  isQuitting = true
  e.preventDefault()
  trafficMonitor?.stop()
  if (service) {
    const svc = service
    service = null
    // 内核 stop() 依赖子进程 exit 事件；极端情况下该事件可能不触发（kill 失效），
    // 用超时兜底保证应用一定能退出。
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      svc.stop().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
      })
    ])
    if (timer) clearTimeout(timer)
  }
  // 退出清理：仅当本会话开启过系统代理时才关闭，
  // 避免误关用户系统自带的代理设置（内核停止后代理端口悬空会导致断网；
  // 自动更新 quitAndInstall 同样经过此路径，防止更新后网络不可用）
  if (proxyExpected === true) {
    try {
      await systemProxy?.set(false)
    } catch {
      /* 关闭失败不阻塞退出 */
    }
    proxyExpected = null
  }
  app.exit(0)
})