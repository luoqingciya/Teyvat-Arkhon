/**
 * 主进程轻量 i18n。
 *
 * 覆盖范围：由**主进程直接产出**、不经过渲染端 i18next 的文案 ——
 * 系统托盘菜单、原生对话框（保存/消息框）、网络自检结果、便携模式提示、
 * UWP 回环豁免提示、系统代理/系统服务错误、更新器提示。
 *
 * 不覆盖：`console.log/warn` 开发者日志（保持中文，便于检索），
 * 以及 core-bridge 抛出的错误（属独立包，另有其自身语义）。
 *
 * 语言来源与渲染端一致（设置页「语言」）：渲染端启动与切换时经 IPC 同步，
 * 主进程同时持久化到 settings.json，保证托盘在窗口加载前即为正确语言。
 *
 * 本模块保持零依赖（仅依赖 shared 的类型），便于被任何主进程模块引用。
 */

import { DEFAULT_UI_LANGUAGE, isUiLanguage, type UiLanguage } from '@teyvat-arkhon/shared'

type Dict = Record<string, string>

const zhCN: Dict = {
  // ---------- 托盘 ----------
  'tray.proxyMode': '代理模式',
  'tray.mode.rule': '规则',
  'tray.mode.global': '全局',
  'tray.mode.direct': '直连',
  'tray.systemProxy.on': '系统代理：已开启',
  'tray.systemProxy.off': '系统代理：已关闭',
  'tray.quickSwitch': '快速切换档案',
  'tray.show': '显示主窗口',
  'tray.quit': '退出',
  'tray.sysProxyRestored': '系统代理设置被外部程序修改，已自动恢复',

  // ---------- 原生对话框 ----------
  'dialog.exportLogs.title': '导出日志',
  'dialog.exportLogs.filter': '日志文件',

  // ---------- 网络自检 ----------
  'netcheck.label.proxy': '代理',
  'netcheck.label.ip': '出口 IP',
  'netcheck.noPort': '内核未运行或未配置代理端口',
  'netcheck.fail.timeout': '请求失败/超时',
  'netcheck.fail.unreachable': '不可达',
  'netcheck.fail.restricted': '受限 HTTP {status}',
  'netcheck.fail.abnormal': '异常 HTTP {status}',
  'netcheck.ok': '可达',
  'netcheck.ok.auth': '可达（需鉴权）',
  'netcheck.ok.region': '可达（区域受限）',

  // ---------- 数据目录 / 便携模式 ----------
  'portable.enabled': '已启用便携模式，重启应用后生效',
  'portable.disabled': '已停用便携模式，重启应用后生效',

  // ---------- UWP 回环豁免 ----------
  'loopback.queryFailed': '查询失败: {msg}',
  'loopback.windowsOnly': '仅 Windows 支持',
  'loopback.none': '未检测到可豁免的应用',
  'loopback.exempted': '已豁免 {done} 个应用（跳过 {failed}）',
  'loopback.revoked': '已撤销 {done} 个应用的豁免（跳过 {failed}）',
  'loopback.failed': '操作失败: {msg}',

  // ---------- 系统服务托管 ----------
  'service.windowsOnly': '系统服务托管目前仅支持 Windows',
  'service.cmdFailed': '服务命令执行失败（退出码 {code}）：\n{detail}',

  // ---------- 系统代理 ----------
  'sysproxy.coreNotRunning': '内核未运行，无法开启系统代理',
  'sysproxy.gsettingsUnsupported': '当前桌面环境不支持 gsettings 系统代理设置: {msg}',

  // ---------- 应用更新 ----------
  'update.err.releaseMissing': '发布尚未完成或版本已下线，请稍后再试',
  'update.err.notFound': '未找到可下载的版本（发布可能尚未完成），请稍后重试',
  'update.err.auth': '更新服务器鉴权失败，请确认发布可用后重试',
  'update.err.network': '无法连接更新服务器，请检查网络后重试',
  'update.dialog.title': '新版本 {version} 已就绪',
  'update.dialog.detail': '可在「设置 → 更新」中安装。是否立即重启应用完成更新？',
  'update.dialog.later': '稍后',
  'update.dialog.restart': '立即重启',
  'update.devDisabled': '开发环境不检查更新',
  'update.envDisabled': '自动更新已被环境变量禁用'
}

const enUS: Dict = {
  // ---------- Tray ----------
  'tray.proxyMode': 'Proxy Mode',
  'tray.mode.rule': 'Rule',
  'tray.mode.global': 'Global',
  'tray.mode.direct': 'Direct',
  'tray.systemProxy.on': 'System Proxy: On',
  'tray.systemProxy.off': 'System Proxy: Off',
  'tray.quickSwitch': 'Switch Profile',
  'tray.show': 'Show Main Window',
  'tray.quit': 'Quit',
  'tray.sysProxyRestored':
    'System proxy was changed by another program and has been restored automatically',

  // ---------- Native dialogs ----------
  'dialog.exportLogs.title': 'Export Logs',
  'dialog.exportLogs.filter': 'Log files',

  // ---------- Network self-check ----------
  'netcheck.label.proxy': 'Proxy',
  'netcheck.label.ip': 'Exit IP',
  'netcheck.noPort': 'Core is not running or no proxy port is configured',
  'netcheck.fail.timeout': 'Request failed / timed out',
  'netcheck.fail.unreachable': 'Unreachable',
  'netcheck.fail.restricted': 'Restricted HTTP {status}',
  'netcheck.fail.abnormal': 'Abnormal HTTP {status}',
  'netcheck.ok': 'Reachable',
  'netcheck.ok.auth': 'Reachable (auth required)',
  'netcheck.ok.region': 'Reachable (region restricted)',

  // ---------- Data directory / portable mode ----------
  'portable.enabled': 'Portable mode enabled. Restart the app to apply.',
  'portable.disabled': 'Portable mode disabled. Restart the app to apply.',

  // ---------- UWP loopback exemption ----------
  'loopback.queryFailed': 'Query failed: {msg}',
  'loopback.windowsOnly': 'Windows only',
  'loopback.none': 'No exemptible apps found',
  'loopback.exempted': 'Exempted {done} apps (skipped {failed})',
  'loopback.revoked': 'Revoked exemption for {done} apps (skipped {failed})',
  'loopback.failed': 'Operation failed: {msg}',

  // ---------- System service hosting ----------
  'service.windowsOnly': 'System service hosting is currently Windows-only',
  'service.cmdFailed': 'Service command failed (exit code {code}):\n{detail}',

  // ---------- System proxy ----------
  'sysproxy.coreNotRunning': 'Core is not running; cannot enable the system proxy',
  'sysproxy.gsettingsUnsupported':
    'The current desktop environment does not support gsettings system proxy: {msg}',

  // ---------- App update ----------
  'update.err.releaseMissing':
    'The release is not ready or has been removed. Please try again later.',
  'update.err.notFound':
    'No downloadable release found (it may not be published yet). Please try again later.',
  'update.err.auth': 'Update server authentication failed. Please verify the release is available.',
  'update.err.network': 'Cannot reach the update server. Check your network and retry.',
  'update.dialog.title': 'Version {version} is ready',
  'update.dialog.detail':
    'You can install it from Settings → Update. Restart now to finish updating?',
  'update.dialog.later': 'Later',
  'update.dialog.restart': 'Restart Now',
  'update.devDisabled': 'Update checks are disabled in development',
  'update.envDisabled': 'Auto update is disabled by an environment variable'
}

const DICTS: Record<UiLanguage, Dict> = { 'zh-CN': zhCN, 'en-US': enUS }

let current: UiLanguage = DEFAULT_UI_LANGUAGE

/** 当前主进程语言 */
export function getMainLanguage(): UiLanguage {
  return current
}

/** 设置主进程语言（非法值回落到默认语言），返回实际采用值 */
export function setMainLanguage(lang: unknown): UiLanguage {
  current = isUiLanguage(lang) ? lang : DEFAULT_UI_LANGUAGE
  return current
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  )
}

/**
 * 取主进程文案。查找顺序：当前语言 → 默认语言 → 原样返回 key
 * （返回 key 便于在界面/日志中直接暴露漏翻项，而不是静默显示空串）。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = DICTS[current][key] ?? DICTS[DEFAULT_UI_LANGUAGE][key] ?? key
  return interpolate(template, params)
}
