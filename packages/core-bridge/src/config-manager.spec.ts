import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConfigManager, mergeKernelDefaults } from './config-manager'

const SAMPLE_YAML = `mixed-port: 7890
external-controller: 127.0.0.1:9090
mode: rule
proxies:
  - name: "HK-01"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-256-gcm
    password: "secret"
  - name: "JP-01"
    type: trojan
    server: 5.6.7.8
    port: 443
    password: "pw"
proxy-groups:
  - name: PROXY
    type: select
    proxies: [HK-01, JP-01]
`

describe('ConfigManager', () => {
  let dir: string
  let profilesDir: string
  let activeFile: string
  let mgr: ConfigManager

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arkhon-test-'))
    profilesDir = path.join(dir, 'profiles')
    activeFile = path.join(dir, 'config', 'config.yaml')
    mgr = new ConfigManager({ profilesDir, activeConfigFile: activeFile })
    await mgr.init()
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('解析合法订阅并统计节点', () => {
    const s = mgr.parseAndValidate(SAMPLE_YAML)
    expect(s.proxies).toHaveLength(2)
    expect(s.proxyGroups).toHaveLength(1)
    expect(s.mixedPort).toBe(7890)
    expect(s.externalController).toBe('127.0.0.1:9090')
  })

  it('拒绝非法 YAML', () => {
    expect(() => mgr.parseAndValidate('proxies: [unclosed')).toThrow(/YAML 解析失败/)
  })

  it('拒绝无 proxies 且无端口的配置', () => {
    expect(() => mgr.parseAndValidate('mode: rule\nrules: []')).toThrow(/无法作为内核配置/)
  })

  it('base64 订阅内容可被解码后导入', async () => {
    const b64 = Buffer.from(SAMPLE_YAML, 'utf-8').toString('base64')
    const { profile } = await mgr.importFromText('test', b64)
    expect(profile.nodeCount).toBe(2)

    const list = await mgr.listProfiles()
    expect(list).toHaveLength(1)
  })

  it('选择档案会写入工作配置并标记 selected', async () => {
    const { profile } = await mgr.importFromText('sub-a', SAMPLE_YAML)
    const summary = await mgr.selectProfile(profile.id)

    const written = await fs.readFile(activeFile, 'utf-8')
    expect(written).toContain('HK-01')
    expect(summary.proxies.length).toBe(2)

    const list = await mgr.listProfiles()
    expect(list.find((p) => p.id === profile.id)?.selected).toBe(true)
  })

  it('删除档案', async () => {
    const { profile } = await mgr.importFromText('sub-a', SAMPLE_YAML)
    await mgr.removeProfile(profile.id)
    expect(await mgr.listProfiles()).toHaveLength(0)
    await expect(fs.access(path.join(profilesDir, `${profile.id}.yaml`))).rejects.toThrow()
  })

  it('刷新订阅保留节点统计', async () => {
    const fakeFetch = (() => Promise.resolve(updatedResponse())) as unknown as typeof fetch
    const { profile } = await mgr.importFromUrl('https://example.com/sub', fakeFetch)
    await mgr.refreshProfile(profile.id, fakeFetch)
    const list = await mgr.listProfiles()
    expect(list[0].url).toBe('https://example.com/sub')
    expect(list[0].nodeCount).toBe(2)
  })

  it('mergeKernelDefaults 仅在缺失时补全监听', () => {
    const out = mergeKernelDefaults('mode: rule')
    expect(out).toContain('mixed-port: 7890')
    expect(out).toContain('127.0.0.1:9090')

    const unchanged = mergeKernelDefaults(SAMPLE_YAML)
    expect(unchanged.match(/mixed-port:/g)).toHaveLength(1)
  })

  it('开关 TUN：启用追加默认段、幂等、禁用可移除', async () => {
    const { profile } = await mgr.importFromText('sub-a', SAMPLE_YAML)
    await mgr.selectProfile(profile.id)

    const on = await mgr.setTunEnabled(true)
    expect(on.tunEnabled).toBe(true)
    const c1 = await fs.readFile(activeFile, 'utf-8')
    expect(c1).toContain('tun: {enable: true')

    // 幂等：重复启用不重复追加
    await mgr.setTunEnabled(true)
    const c2 = await fs.readFile(activeFile, 'utf-8')
    expect(c2.match(/^\s*tun:/m)).toHaveLength(1)

    // 禁用后移除应用默认段
    await mgr.setTunEnabled(false)
    const c3 = await fs.readFile(activeFile, 'utf-8')
    expect(/^\s*tun:/.test(c3)).toBe(false)
  })
})

function updatedResponse(): Response {
  return new Response(SAMPLE_YAML, { status: 200 })
}