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

  it('hysteria2 单节点链接可被转换导入', async () => {
    const uri =
      'hysteria2://pass123@example.com:443/?insecure=1&sni=cdn.example.com&obfs=salamander&obfs-password=obs#HK-Hy2'
    const { profile, summary } = await mgr.importFromText('hy2', uri)
    expect(profile.nodeCount).toBe(1)
    expect(summary.proxies[0]).toMatchObject({ type: 'hysteria2' })

    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(raw).toContain('hysteria2')
    expect(raw).toContain('skip-cert-verify: true')
    expect(raw).toContain('cdn.example.com')
  })

  it('hysteria2 URI 携带 pinSHA256 时映射为 mihomo fingerprint（否则自签证书握手失败）', async () => {
    const uri =
      'hysteria2://pass123@example.com:443/?pinSHA256=BA%3A88%3A45%3A17%3AA1&obfs=salamander&obfs-password=obs&up=100&down=250#HK-Pin'
    const { profile } = await mgr.importFromText('hy2-pin', uri)
    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    // 指纹归一为裸 hex（去除冒号分隔）
    expect(raw).toContain('fingerprint: BA884517A1')
    // 纯数字带宽自动补单位，避免 mihomo yaml 解析失败
    expect(raw).toContain('up: 100 Mbps')
    expect(raw).toContain('down: 250 Mbps')
  })

  it('hysteria2 URI 携带 mport 端口跳跃时映射为 mihomo ports+hop-interval', async () => {
    // 结构取自真实订阅链接（域名/cert 脱敏）
    const uri =
      'hysteria2://7my4428n85v3619a@device.example.site:29862?alpn=h3&fp=chrome&mport=45000-50000&obfs=salamander&obfs-password=2nrn7qtujssuynyf&security=tls&sni=device.example.site#Master%20Studio-zz'
    const { profile, summary } = await mgr.importFromText('hy2-real', uri)
    expect(profile.nodeCount).toBe(1)
    expect(summary.proxies[0]).toMatchObject({ type: 'hysteria2' })

    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(raw).toContain('ports: 45000-50000')
    expect(raw).toContain("hop-interval: '30'")
    expect(raw).toContain('obfs-password: 2nrn7qtujssuynyf')
    expect(raw).toContain('sni: device.example.site')
    expect(raw).toContain('name: Master Studio-zz')
  })

  it('混合内容的文本不会被误转，仍按 YAML 校验失败', async () => {
    const mixed = 'hysteria2://pass@a.com:443/#A\nproxy-groups: []'
    await expect(mgr.importFromText('mixed', mixed)).rejects.toThrow(/YAML|无法作为内核配置/)
  })

  it.each([
    ['ss base64 形态', 'ss://' + Buffer.from('aes-256-gcm:pass123@1.2.3.4:8388', 'utf-8').toString('base64') + '#SS-01', 'ss'],
    ['ss 直写形态', 'ss://aes-256-gcm:pass123@5.6.7.8:443#SS-02', 'ss'],
    ['vmess', 'vmess://' + Buffer.from(
      JSON.stringify({ v: '2', ps: 'VM-A', add: 'vm.example.com', port: '443', id: '1111-2222', aid: '0', net: 'ws', path: '/ws', host: 'vm.example.com', tls: 'tls', scy: 'auto' }),
      'utf-8'
    ).toString('base64'), 'vmess'],
    ['vless reality', 'vless://uuid-0001@vl.example.com:443?type=tcp&security=reality&sni=gh.example&pbk=PUB&sid=ABCD&flow=xtls-rprx-vision#VL-01', 'vless'],
    ['trojan ws', 'trojan://pass-tj@tj.example.com:443?type=ws&path=%2Fstream&host=tj.example.com&sni=tj.example.com#TJ-01', 'trojan']
  ])('%s 可转换导入', async (_label, uri, expectedType) => {
    const { profile, summary } = await mgr.importFromText('legacy', uri)
    expect(profile.nodeCount).toBe(1)
    expect(summary.proxies[0].type).toBe(expectedType)
  })

  it('sing-box 导出 JSON 可转换导入', async () => {
    const sb = JSON.stringify({
      version: 1,
      outbounds: [
        {
          type: 'vless',
          tag: 'SB-VLESS',
          server: 'sb.example.com',
          server_port: 443,
          uuid: 'aaa-bbb',
          tls: { enabled: true, server_name: 'sb.example.com', utls: { enabled: true, fingerprint: 'chrome' } },
          transport: { type: 'ws', path: '/ws', headers: { Host: 'sb.example.com' } }
        },
        { type: 'shadowsocks', tag: 'SB-SS', server: 'sb2.example.com', server_port: 8388, method: 'chacha20-ietf-poly1305', password: 'pwd' }
      ]
    })
    const { profile, summary } = await mgr.importFromText('singbox', sb)
    expect(profile.nodeCount).toBe(2)
    const types = summary.proxies.map((p) => p.type).sort()
    expect(types).toEqual(['ss', 'vless'])
  })

  it('vless reality 带 flow 与 grpc serviceName 正确落盘（flow 不依赖 encryption）', async () => {
    const uri =
      'vless://uuid-0001@vl.example.com:443?type=grpc&serviceName=naive&security=reality&sni=gh.example&pbk=PUB&sid=AB12&flow=xtls-rprx-vision#VL-R'
    const { profile } = await mgr.importFromText('vless-r', uri)
    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(raw).toContain('flow: xtls-rprx-vision')
    expect(raw).toContain('reality-opts:')
    expect(raw).toContain('public-key: PUB')
    expect(raw).toContain('short-id: AB12')
    // grpc service-name 参数不得被当成 Host（此前会丢失导致连不上）
    expect(raw).toContain('grpc-service-name: naive')
  })

  it('trojan grpc serviceName 参数正确落盘', async () => {
    const uri = 'trojan://pass-tj@tj.example.com:443?type=grpc&serviceName=gst#TJ-G'
    const { profile } = await mgr.importFromText('trojan-g', uri)
    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(raw).toContain('grpc-service-name: gst')
  })

  it('sing-box vless flow 与 tuic congestion-controller 正确落盘', async () => {
    const sb = JSON.stringify({
      outbounds: [
        {
          type: 'vless',
          tag: 'SB-VL-FLOW',
          server: 'sb.example.com',
          server_port: 443,
          uuid: 'aaa-bbb',
          flow: 'xtls-rprx-vision',
          tls: { enabled: true, server_name: 'sb.example.com' }
        },
        {
          type: 'tuic',
          tag: 'SB-TUIC',
          server: 'tuic.example.com',
          server_port: 443,
          uuid: 'ccc-ddd',
          password: 'tpass',
          congestion_control: 'bbr',
          tls: { enabled: true, server_name: 'tuic.example.com', alpn: ['h3'], utls: { enabled: true, fingerprint: 'chrome' } }
        }
      ]
    })
    const { profile } = await mgr.importFromText('singbox2', sb)
    const raw = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(raw).toContain('flow: xtls-rprx-vision')
    expect(raw).toContain('congestion-controller: bbr')
    expect(raw).toContain('client-fingerprint: chrome')
    expect(raw).toContain('alpn:')
  })

  it('SSD JSON 可转换导入', async () => {
    const ssd = JSON.stringify({
      airplan: 'test',
      servers: [
        { server: 'ssd.example.com', server_port: 8388, password: 'pw', method: 'aes-128-gcm', remarks: 'SSD-A' }
      ]
    })
    const { profile, summary } = await mgr.importFromText('ssd', ssd)
    expect(profile.nodeCount).toBe(1)
    expect(summary.proxies[0].type).toBe('ss')
  })

  it('Surge 节点行可转换导入', async () => {
    const surge = ['HK = ss, 1.2.3.4, 8388, encrypt-method=aes-256-gcm, password=surge-pwd', 'US = trojan, 5.6.7.8, 443, password=tj'].join('\n')
    const { profile, summary } = await mgr.importFromText('surge', surge)
    expect(profile.nodeCount).toBe(2)
    const types = summary.proxies.map((p) => p.type).sort()
    expect(types).toEqual(['ss', 'trojan'])
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

  it('刷新 v2rayN URI 订阅时同样走转换（与首次导入一致）', async () => {
    const uriBody = 'hysteria2://pass@hy.example.com:443/?insecure=1&sni=hy.example.com#HK-Hy2'
    const fakeFetch = (() =>
      Promise.resolve(new Response(uriBody))) as unknown as typeof fetch
    const { profile } = await mgr.importFromUrl('https://example.com/hy2sub', fakeFetch)
    // 首次导入即已转换
    const first = await fs.readFile(path.join(profilesDir, `${profile.id}.yaml`), 'utf-8')
    expect(first).toContain('hysteria2')
    // 刷新（无变化内容）仍应转换成功，而非按 YAML 校验失败
    await mgr.refreshProfile(profile.id, fakeFetch)
    const list = await mgr.listProfiles()
    expect(list[0].nodeCount).toBe(1)
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

  it('setActiveMode 持久化：替换已有 mode 行、幂等、缺失时追加', async () => {
    const { profile } = await mgr.importFromText('sub-a', SAMPLE_YAML)
    await mgr.selectProfile(profile.id)

    // 已有 mode: rule → 替换为 global
    await mgr.setActiveMode('global')
    let c = await fs.readFile(activeFile, 'utf-8')
    expect(/^\s*mode:\s*global\s*$/m.test(c)).toBe(true)
    expect(c.match(/^\s*mode:/gm)).toHaveLength(1)

    // 幂等：同值不重复写入
    await mgr.setActiveMode('global')
    expect((await fs.readFile(activeFile, 'utf-8')).match(/^\s*mode:/gm)).toHaveLength(1)

    // 无 mode 行的配置：追加
    await fs.writeFile(activeFile, 'mixed-port: 7890\n', 'utf-8')
    await mgr.setActiveMode('direct')
    c = await fs.readFile(activeFile, 'utf-8')
    expect(/^\s*mode:\s*direct\s*$/m.test(c)).toBe(true)
  })
})

function updatedResponse(): Response {
  return new Response(SAMPLE_YAML, { status: 200 })
}