import { describe, it, expect } from 'vitest'
import * as yaml from 'js-yaml'
import { clashProxiesToUriList } from './uri-export'
import { tryConvertUriProfile } from './uri-profiles'

function parseProxies(yamlText: string): Array<Record<string, unknown>> {
  const cfg = yaml.load(yamlText) as { proxies: Array<Record<string, unknown>> }
  return cfg.proxies
}

describe('clashProxiesToUriList（Clash 配置 → 分享 URI 列表）', () => {
  it('ss：cipher:password 编码为 base64url，带节点名 fragment', () => {
    const out = clashProxiesToUriList([
      { name: 'HK-01', type: 'ss', server: '1.2.3.4', port: 8388, cipher: 'aes-256-gcm', password: 'secret' }
    ])
    expect(out).toBe('ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#HK-01')
  })

  it('vmess：输出 base64 JSON，携带 uuid/传输/tls', () => {
    const out = clashProxiesToUriList([
      {
        name: 'vm', type: 'vmess', server: 'v.example.com', port: 443, uuid: 'uuid-1', alterId: 0,
        cipher: 'auto', tls: true, servername: 'v.example.com', network: 'ws',
        'ws-opts': { path: '/ws', headers: { Host: 'v.example.com' } }
      }
    ])
    const b64 = out.split('vmess://')[1].split('#')[0]
    const j = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
    expect(j).toMatchObject({ v: '2', add: 'v.example.com', id: 'uuid-1', net: 'ws', type: 'none', tls: 'tls' })
    expect(j.path).toBe('/ws')
    expect(j.host).toBe('v.example.com')
  })

  it('vless：query 含 encryption/type/security/sni/flow', () => {
    const out = clashProxiesToUriList([
      {
        name: 'vl', type: 'vless', server: 'l.example.com', port: 443, uuid: 'uuid-2',
        network: 'ws', 'ws-opts': { path: '/x', headers: { Host: 'l.example.com' } },
        tls: true, servername: 'l.example.com', flow: 'xtls-rprx-vision', 'client-fingerprint': 'chrome'
      }
    ])
    const u = new URL(out)
    expect(u.protocol).toBe('vless:')
    expect(u.searchParams.get('encryption')).toBe('none')
    expect(u.searchParams.get('type')).toBe('ws')
    expect(u.searchParams.get('security')).toBe('tls')
    expect(u.searchParams.get('sni')).toBe('l.example.com')
    expect(u.searchParams.get('flow')).toBe('xtls-rprx-vision')
    expect(u.hash).toBe('#vl')
  })

  it('trojan：password 编码进 userinfo，sni/type 进 query', () => {
    const out = clashProxiesToUriList([
      { name: 'tj', type: 'trojan', server: 't.example.com', port: 443, password: 'pw123', sni: 't.example.com' }
    ])
    const u = new URL(out)
    expect(u.protocol).toBe('trojan:')
    expect(u.username).toBe('pw123')
    expect(u.searchParams.get('sni')).toBe('t.example.com')
  })

  it('hysteria2：obfs/obfs-password/sni/pinSHA256（裸 hex → 冒号）映射', () => {
    const out = clashProxiesToUriList([
      {
        name: 'hy2', type: 'hysteria2', server: 'h.example.com', port: 29862, password: 'pass1',
        obfs: 'salamander', 'obfs-password': 'obs', sni: 'h.example.com', fingerprint: 'BA884517A1'
      }
    ])
    const u = new URL(out)
    expect(u.protocol).toBe('hysteria2:')
    expect(u.searchParams.get('obfs')).toBe('salamander')
    expect(u.searchParams.get('obfs-password')).toBe('obs')
    expect(u.searchParams.get('pinSHA256')).toBe('BA:88:45:17:A1')
  })

  it('hysteria2：pure 数字 up/down 去掉 Mbps 单位', () => {
    const out = clashProxiesToUriList([
      { name: 'hy2b', type: 'hysteria2', server: 'h2.example.com', port: 443, password: 'p', up: '100 Mbps', down: '250 Mbps' }
    ])
    const u = new URL(out)
    expect(u.searchParams.get('up')).toBe('100')
    expect(u.searchParams.get('down')).toBe('250')
  })

  it('hysteria2：端口跳跃 ports → mport', () => {
    const out = clashProxiesToUriList([
      { name: 'hy2c', type: 'hysteria2', server: 'h3.example.com', port: 29862, password: 'p', ports: '45000-50000' }
    ])
    const u = new URL(out)
    expect(u.searchParams.get('mport')).toBe('45000-50000')
  })

  it('tuic：uuid:password userinfo + congestion_control', () => {
    const out = clashProxiesToUriList([
      { name: 'tu', type: 'tuic', server: 'u.example.com', port: 443, uuid: 'uuid-3', password: 'pw', 'congestion-controller': 'bbr' }
    ])
    const u = new URL(out)
    expect(u.protocol).toBe('tuic:')
    expect(u.username).toBe('uuid-3')
    expect(u.searchParams.get('congestion_control')).toBe('bbr')
  })

  it('不支持的协议（wireguard）跳过，不影响其他节点', () => {
    const out = clashProxiesToUriList([
      { name: 'wg', type: 'wireguard', server: 'w.example.com', port: 51820, 'private-key': 'x' },
      { name: 's5', type: 'socks5', server: 's.example.com', port: 1080 }
    ])
    expect(out.split('\n').filter(Boolean)).toHaveLength(1)
    expect(out).toContain('socks5://s.example.com:1080#s5')
  })

  it('往返：URI 导入 → 导出，核心字段保持一致', () => {
    const uri =
      'hysteria2://pass@hy.example.com:443/?sni=hy.example.com&obfs=salamander&obfs-password=obs#Hy-01\n' +
      'ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#SS-01'
    const yamlText = tryConvertUriProfile(uri)!
    const out = clashProxiesToUriList(parseProxies(yamlText))
    const lines = out.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('hysteria2://pass@hy.example.com:443?')
    expect(lines[0]).toContain('obfs=salamander')
    expect(lines[1]).toBe('ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#SS-01')
  })
})