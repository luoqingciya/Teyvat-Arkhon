/**
 * 工作配置（内核实际读取的那份 config.yaml）的**文件级操作**。
 *
 * 从 ConfigManager 抽出，使「读取 / 校验解析 / 写入（含备份轮转与 tun 段保留）/
 * 模式与 TUN 开关 / DNS 段读写」成为可独立推理与测试的单元，
 * 而不是混在档案 CRUD、订阅刷新与规则编辑之中。
 *
 * 本模块只关心「那一份文件」，不感知档案索引、订阅与规则集。
 */

import { promises as fs } from 'node:fs'
import yaml from 'js-yaml'
import type { ClashConfigSummary, DnsSettings } from '@teyvat-arkhon/shared'
import { applyDnsToConfig, parseDnsSettings, validateDnsSettings } from './dns-editor'
import {
  DEFAULT_CONTROLLER,
  TUN_DEFAULT,
  escapeRegExp,
  exists,
  isRecord,
  numberVal,
  stringVal
} from './config-utils'

/** 校验并解析配置文本，返回摘要；不合法时抛 Error（含行列定位信息） */
export function parseConfigAndValidate(text: string): ClashConfigSummary {
  let raw: unknown
  try {
    raw = yaml.load(text)
  } catch (e) {
    // js-yaml 的 YAMLException 携带 mark（0 起行/列 + 上下文片段），拼进错误以精确定位
    const mark = (e as { mark?: { line?: number; column?: number; snippet?: string } }).mark
    if (mark && typeof mark.line === 'number') {
      const line = mark.line + 1
      const col = (mark.column ?? 0) + 1
      throw new Error(
        `YAML 解析失败（第 ${line} 行，第 ${col} 列）：${(e as Error).message}` +
          (mark.snippet ? `\n${mark.snippet}` : '')
      )
    }
    throw new Error(`YAML 解析失败: ${(e as Error).message}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('配置内容不是合法的 YAML 映射（可能订阅已失效或格式错误）')
  }
  const cfg = raw as Record<string, unknown>

  const proxies = Array.isArray(cfg.proxies)
    ? (cfg.proxies as Array<Record<string, unknown>>)
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({ name: String(p.name ?? '未命名节点'), type: String(p.type ?? 'unknown') }))
    : []
  const proxyGroups = Array.isArray(cfg['proxy-groups'])
    ? (cfg['proxy-groups'] as Array<Record<string, unknown>>)
        .filter((g) => g && typeof g === 'object')
        .map((g) => ({ name: String(g.name ?? ''), type: String(g.type ?? 'selector') }))
    : []

  const port = numberVal(cfg['mixed-port']) ?? numberVal(cfg.port) ?? numberVal(cfg['socks-port'])
  if (proxies.length === 0 && !port) {
    throw new Error('未找到可用的 proxies 或监听端口配置，无法作为内核配置')
  }

  const controller = stringVal(cfg['external-controller']) ?? DEFAULT_CONTROLLER
  return {
    mixedPort: numberVal(cfg['mixed-port']) ?? numberVal(cfg.port),
    httpPort: numberVal(cfg.port),
    socksPort: numberVal(cfg['socks-port']),
    externalController: controller,
    secret: stringVal(cfg.secret),
    tunEnabled: isRecord(cfg.tun) ? cfg.tun.enable === true : false,
    proxies,
    proxyGroups
  }
}

/** 默认空 DNS 状态（不写入配置，仅编辑期占位） */
function emptyDns(): DnsSettings {
  return {
    enable: false,
    enhancedMode: 'redir-host',
    ipv6: false,
    fakeIpRange: '198.18.0.1/16',
    fakeIpFilter: [],
    defaultNameserver: [],
    nameserver: [],
    proxyServerNameserver: [],
    respectRules: false,
    fallback: [],
    nameserverPolicy: []
  }
}

/** 工作配置的文件级读写（内核实际读取的那一份） */
export class ActiveConfigStore {
  constructor(private readonly file: string) {}

  /** 读取原文（编辑器用）；文件缺失返回空串 */
  async read(): Promise<string> {
    if (!(await exists(this.file))) return ''
    return fs.readFile(this.file, 'utf-8')
  }

  /** 读取摘要（文件缺失返回 null） */
  async summary(): Promise<ClashConfigSummary | null> {
    if (!(await exists(this.file))) return null
    return parseConfigAndValidate(await fs.readFile(this.file, 'utf-8'))
  }

  /** 读取最近一份备份原文（回滚用）；无备份返回空串 */
  async readBackup(): Promise<string> {
    const base = `${this.file}.bak`
    if (await exists(base)) return fs.readFile(base, 'utf-8')
    return ''
  }

  /** 校验并覆写（编辑器保存），不合法时抛 Error 且不落盘 */
  async writeValidated(content: string): Promise<ClashConfigSummary> {
    const summary = parseConfigAndValidate(content)
    await this.write(content)
    return summary
  }

  /**
   * 写工作配置（统一入口）：写前先轮转备份上一份到 config.yaml.bak（最多保留 3 份）。
   * 任何写入（档案切换/编辑器保存/DNS/规则/TUN/模式）都会留下可回滚副本。
   * 默认保留 tun 段：订阅刷新等重写流程生成的内容不含 tun，直接覆盖会把已开启的
   * TUN 弄丢（历史 bug：config.yaml.bak 含 tun、config.yaml 无 tun）。
   */
  async write(content: string, opts?: { keepTun?: boolean }): Promise<void> {
    const merged = opts?.keepTun === false ? content : await this.preserveTun(content)
    await this.rotateBackup()
    await fs.writeFile(this.file, merged, 'utf-8')
  }

  /**
   * 持久化运行模式（重启内核后仍保留）。
   * 已有 mode 行则替换，否则追加；仅当值变化时写盘。
   */
  async setMode(mode: 'rule' | 'global' | 'direct'): Promise<void> {
    if (!(await exists(this.file))) return
    const content = await fs.readFile(this.file, 'utf-8')
    if (new RegExp(`^\\s*mode:\\s*${mode}\\s*$`, 'm').test(content)) return

    const line = `mode: ${mode}`
    const next = /^\s*mode:\s*/m.test(content)
      ? content.replace(/^(\s*mode:\s*).*$/m, `$1${mode}`)
      : content.endsWith('\n')
        ? content + line + '\n'
        : content + '\n' + line + '\n'
    if (next !== content) await this.write(next)
  }

  /**
   * 开关 TUN 模式。
   * 启用：无 tun 段时以应用默认值追加（已有自定义 tun 段则不动）；
   * 禁用：仅移除应用默认写入的那一行，用户自定义段保留。
   */
  async setTun(enabled: boolean): Promise<ClashConfigSummary> {
    if (!(await exists(this.file))) throw new Error('没有可用的工作配置，请先选择订阅')
    const content = await fs.readFile(this.file, 'utf-8')
    const hasTun = /^\s*tun:\s*/m.test(content)

    let next = content
    if (enabled) {
      if (!hasTun) {
        next = content.endsWith('\n') ? content + TUN_DEFAULT + '\n' : content + '\n' + TUN_DEFAULT + '\n'
      }
    } else if (hasTun) {
      next = content
        .replace(new RegExp(`^${escapeRegExp(TUN_DEFAULT.trim())}\\s*$`, 'm'), '')
        .replace(/\n{2,}/g, '\n')
    }

    if (next !== content) {
      // 显式关闭 TUN：跳过保留逻辑（否则 preserveTun 会把刚移除的 tun 行粘回）
      await this.write(next, { keepTun: false })
    }
    return parseConfigAndValidate(next)
  }

  /** 读取 dns 段，解析为结构化编辑状态（文件缺失返回默认空态） */
  async readDns(): Promise<DnsSettings> {
    if (!(await exists(this.file))) return emptyDns()
    let cfg: unknown
    try {
      cfg = yaml.load(await fs.readFile(this.file, 'utf-8'))
    } catch {
      return emptyDns()
    }
    if (!isRecord(cfg)) return emptyDns()
    return parseDnsSettings(cfg)
  }

  /** 将结构化 dns 段序列化写回（文本级替换，保留其它内容） */
  async writeDns(settings: DnsSettings): Promise<ClashConfigSummary> {
    if (!(await exists(this.file))) throw new Error('没有可用的工作配置，请先选择订阅')
    const issues = validateDnsSettings(settings)
    if (issues.length) throw new Error(`DNS 配置不合法：${issues[0]}`)
    const raw = await fs.readFile(this.file, 'utf-8')
    const { text } = applyDnsToConfig(raw, settings)
    await this.write(text)
    return parseConfigAndValidate(text)
  }

  /** 新内容缺 tun 段但当前文件有 tun 时，把该段（整行）粘回新内容，避免重写丢失 TUN */
  private async preserveTun(content: string): Promise<string> {
    if (/^\s*tun:\s*/m.test(content)) return content
    const prev = await fs.readFile(this.file, 'utf-8').catch(() => '')
    const m = prev.match(/^\s*tun:[^\n]*$/m)
    if (!m) return content
    const line = m[0].trim()
    return (content.endsWith('\n') ? content + line : content + '\n' + line) + '\n'
  }

  private async rotateBackup(): Promise<void> {
    if (!(await exists(this.file))) return
    const base = `${this.file}.bak`
    try {
      await fs.rm(`${base}.2`, { force: true })
      if (await exists(`${base}.1`)) await fs.rename(`${base}.1`, `${base}.2`)
      if (await exists(base)) await fs.rename(base, `${base}.1`)
      await fs.copyFile(this.file, base)
    } catch (e) {
      /* 备份失败不阻塞写入（仅记录） */
      console.warn('[teyvat-arkhon] 工作配置备份失败:', (e as Error).message)
    }
  }
}
