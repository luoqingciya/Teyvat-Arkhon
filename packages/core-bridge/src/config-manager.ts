/**
 * 订阅配置档案管理：
 *  - profiles/<id>.yaml 存放导入的订阅内容
 *  - profiles/index.json 记录档案元数据
 *  - <activeConfigFile> 为当前生效的工作配置（选中的档案拷贝，可被内核读取）
 *
 * YAML 解析/校验使用 js-yaml；订阅文本可能为 base64 编码，优先解码后解析。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'
import {
  decodeProfilePayload,
  type ClashConfigSummary,
  type Profile
} from '@teyvat-arkhon/shared'
import { tryConvertUriProfile } from './uri-profiles'

export interface ConfigManagerOptions {
  profilesDir: string
  activeConfigFile: string
}

const DEFAULT_MIXED_PORT = 7890
const DEFAULT_CONTROLLER = '127.0.0.1:9090'
const TUN_DEFAULT = 'tun: {enable: true, stack: mixed, mtu: 1500, auto-route: true, auto-detect-interface: true, strict-route: false}'

export class ConfigManager {
  private readonly profilesDir: string
  private readonly activeConfigFile: string

  constructor(opts: ConfigManagerOptions) {
    this.profilesDir = opts.profilesDir
    this.activeConfigFile = opts.activeConfigFile
  }

  /** 初始化目录结构与索引（幂等） */
  async init(): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true })
    await fs.mkdir(path.dirname(this.activeConfigFile), { recursive: true })
    const idx = this.indexPath()
    if (!(await exists(idx))) {
      await this.writeIndex([])
    }
  }

  private indexPath(): string {
    return path.join(this.profilesDir, 'index.json')
  }

  private profileFile(id: string): string {
    return path.join(this.profilesDir, `${id}.yaml`)
  }

  private async readIndex(): Promise<Profile[]> {
    const idx = this.indexPath()
    if (!(await exists(idx))) return []
    try {
      const raw = await fs.readFile(idx, 'utf-8')
      return JSON.parse(raw) as Profile[]
    } catch {
      return []
    }
  }

  private async writeIndex(list: Profile[]): Promise<void> {
    await fs.writeFile(this.indexPath(), JSON.stringify(list, null, 2), 'utf-8')
  }

  /** 校验并解析订阅文本，返回配置摘要；不合法时抛 Error（含定位信息） */
  parseAndValidate(text: string): ClashConfigSummary {
    let raw: unknown
    try {
      raw = yaml.load(text)
    } catch (e) {
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

  async listProfiles(): Promise<Profile[]> {
    return this.readIndex()
  }

  /** 从 URL 导入订阅：下载 → 解码 → 校验 → 落盘 */
  async importFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<{ profile: Profile; summary: ClashConfigSummary }> {
    let res: Response
    try {
      // 多数订阅服务商会校验 User-Agent
      res = await fetchImpl(url, { headers: { 'user-agent': 'TeyvatArkhon/0.1 clash-verge-rev-compatible' } })
    } catch (e) {
      throw new Error(`下载订阅失败: ${(e as Error).message}`)
    }
    if (!res.ok) {
      throw new Error(`订阅下载失败: HTTP ${res.status}`)
    }
    return this.importFromText(urlTextToName(url), decodeProfilePayload(await res.text()), url)
  }

  /** 从文本内容导入订阅；url 可选（URL 导入时携带，用于刷新） */
  async importFromText(name: string, text: string, url?: string): Promise<{ profile: Profile; summary: ClashConfigSummary }> {
    const decoded = decodeProfilePayload(text)
    // 非 YAML 内容：尝试识别单节点 URI 列表（如 hysteria2://），转换未命中则按原文本校验
    const content = tryConvertUriProfile(decoded) ?? decoded
    const summary = this.parseAndValidate(content)

    const id = randomUUID()
    const profile: Profile = {
      id,
      name: name.trim() || '未命名订阅',
      url,
      updatedAt: new Date().toISOString(),
      selected: false,
      nodeCount: summary.proxies.length
    }

    const list = await this.readIndex()
    list.push(profile)
    await fs.writeFile(this.profileFile(id), content, 'utf-8')
    await this.writeIndex(list)
    return { profile, summary }
  }

  /** 删除档案 */
  async removeProfile(id: string): Promise<void> {
    const list = (await this.readIndex()).filter((p) => p.id !== id)
    await this.writeIndex(list)
    await fs.rm(this.profileFile(id), { force: true })
  }

  /** 重新拉取订阅并覆盖本地内容 */
  async refreshProfile(id: string, fetchImpl: typeof fetch = fetch): Promise<Profile> {
    const list = await this.readIndex()
    const profile = list.find((p) => p.id === id)
    if (!profile) throw new Error('档案不存在')
    if (!profile.url) throw new Error('本地档案无可刷新地址')

    const res = await fetchImpl(profile.url, { headers: { 'user-agent': 'TeyvatArkhon/0.1' } })
    if (!res.ok) throw new Error(`订阅刷新失败: HTTP ${res.status}`)
    const content = decodeProfilePayload(await res.text())
    const summary = this.parseAndValidate(content)

    profile.updatedAt = new Date().toISOString()
    profile.nodeCount = summary.proxies.length
    await fs.writeFile(this.profileFile(id), content, 'utf-8')
    await this.writeIndex(list)
    return profile
  }

  /** 切换当前使用档案：拷贝到工作配置并补齐缺失的默认监听项 */
  async selectProfile(id: string): Promise<ClashConfigSummary> {
    const list = await this.readIndex()
    const profile = list.find((p) => p.id === id)
    if (!profile) throw new Error('档案不存在')

    const content = await fs.readFile(this.profileFile(id), 'utf-8')
    const enhanced = mergeKernelDefaults(content)
    await fs.writeFile(this.activeConfigFile, enhanced, 'utf-8')

    for (const p of list) p.selected = p.id === id
    await this.writeIndex(list)
    return this.parseAndValidate(enhanced)
  }

  /** 读取当前工作配置摘要（文件缺失返回 null） */
  async getActiveSummary(): Promise<ClashConfigSummary | null> {
    if (!(await exists(this.activeConfigFile))) return null
    const content = await fs.readFile(this.activeConfigFile, 'utf-8')
    return this.parseAndValidate(content)
  }

  /** 读取当前工作配置原文（编辑器用）；文件缺失返回空串 */
  async readActiveRaw(): Promise<string> {
    if (!(await exists(this.activeConfigFile))) return ''
    return fs.readFile(this.activeConfigFile, 'utf-8')
  }

  /** 校验并覆写工作配置（编辑器保存），不合法时抛 Error 且不落盘 */
  async writeActiveValidated(content: string): Promise<ClashConfigSummary> {
    const summary = this.parseAndValidate(content)
    await fs.writeFile(this.activeConfigFile, content, 'utf-8')
    return summary
  }

  /**
   * 开关 TUN 模式（写回工作配置）。
   * 启用：无 tun 段时以应用默认值追加（已有自定义 tun 段则不动）；
   * 禁用：仅移除应用默认写入的那一行，用户自定义段保留。
   */
  async setTunEnabled(enabled: boolean): Promise<ClashConfigSummary> {
    if (!(await exists(this.activeConfigFile))) throw new Error('没有可用的工作配置，请先选择订阅')
    const content = await fs.readFile(this.activeConfigFile, 'utf-8')
    const hasTun = /^\s*tun:\s*/m.test(content)

    let next = content
    if (enabled) {
      if (!hasTun) next = content.endsWith('\n') ? content + TUN_DEFAULT + '\n' : content + '\n' + TUN_DEFAULT + '\n'
    } else if (hasTun) {
      next = content.replace(new RegExp(`^${escapeRegExp(TUN_DEFAULT.trim())}\\s*$`, 'm'), '').replace(/\n{2,}/g, '\n')
    }

    if (next !== content) {
      await fs.writeFile(this.activeConfigFile, next, 'utf-8')
    }
    return this.parseAndValidate(next)
  }
}

function numberVal(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function stringVal(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function urlTextToName(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    /* 非标准 URL 忽略 */
  }
  return url.split('/').pop() ?? url
}

/** 缺失监听端口/外控时补充默认值（仅追加不覆盖），保证内核可直接运行 */
export function mergeKernelDefaults(content: string): string {
  const has = (key: string) => new RegExp(`^\\s*${key}:`, 'm').test(content)
  const block: string[] = []
  if (!has('mixed-port')) block.push(`mixed-port: ${DEFAULT_MIXED_PORT}`)
  if (!has('external-controller')) block.push(`external-controller: ${DEFAULT_CONTROLLER}`)
  if (block.length === 0) return content
  const sep = content.endsWith('\n') ? '' : '\n'
  return content + sep + block.join('\n') + '\n'
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}