import { describe, it, expect } from 'vitest'
import {
  applyDnsToConfig,
  buildDnsBlock,
  listDnsPresetMetas,
  parseDnsSettings,
  validateDnsSettings
} from './dns-editor'
import type { DnsSettings } from '@teyvat-arkhon/shared'

const SAMPLE: DnsSettings = {
  enable: true,
  enhancedMode: 'fake-ip',
  ipv6: false,
  fakeIpRange: '198.18.0.1/16',
  defaultNameserver: ['223.5.5.5'],
  nameserver: ['https://doh.pub/dns-query'],
  fallback: ['tls://8.8.8.8'],
  nameserverPolicy: [
    { domain: 'geosite:cn', server: '223.5.5.5' },
    { domain: 'geosite:geolocation-!cn', server: 'proxy' }
  ]
}

describe('parseDnsSettings', () => {
  it('从 yaml dns 对象解析为结构化状态', () => {
    const cfg = {
      dns: {
        enable: true,
        'enhanced-mode': 'fake-ip',
        ipv6: false,
        'fake-ip-range': '198.18.0.1/16',
        'default-nameserver': ['223.5.5.5'],
        nameserver: ['https://doh.pub/dns-query'],
        fallback: ['tls://8.8.8.8'],
        'nameserver-policy': { 'geosite:cn': '223.5.5.5' }
      }
    }
    expect(parseDnsSettings(cfg)).toMatchObject({
      enable: true,
      enhancedMode: 'fake-ip',
      nameserver: ['https://doh.pub/dns-query'],
      nameserverPolicy: [{ domain: 'geosite:cn', server: '223.5.5.5' }]
    })
  })

  it('缺失/dns 非对象时返回默认空态', () => {
    expect(parseDnsSettings({})).toMatchObject({ enable: true, nameserver: [], fallback: [] })
    expect(parseDnsSettings(null)).toMatchObject({ nameserver: [] })
  })
})

describe('buildDnsBlock / applyDnsToConfig', () => {
  it('序列化并按文本替换 dns 段', () => {
    const raw = 'mixed-port: 7890\ndns:\n  enable: false\nrules:\n  - MATCH,DIRECT\n'
    const { text, patched } = applyDnsToConfig(raw, SAMPLE)
    expect(patched).toBe(true)
    expect(text).toContain('enhanced-mode: fake-ip')
    expect(text).toContain('nameserver-policy:')
    expect(text).toContain('    geosite:cn: 223.5.5.5')
    // 原 dns 块的 false 已被覆盖
    expect(text).toContain('enable: true')
    // 保留 rules 段与其内容
    expect(text).toContain('rules:')
    expect(text).toContain('MATCH,DIRECT')
  })

  it('配置不含 dns 段时在末尾追加', () => {
    const raw = 'mixed-port: 7890\n'
    const { text, patched } = applyDnsToConfig(raw, SAMPLE)
    expect(patched).toBe(false)
    expect(text).toContain('dns:')
    expect(text).toContain('enable: true')
  })
})

describe('validateDnsSettings', () => {
  it('缺少 nameserver 时报警', () => {
    expect(validateDnsSettings({ ...SAMPLE, nameserver: [] })).toEqual(
      expect.arrayContaining([expect.stringContaining('nameserver')])
    )
  })

  it('fake-ip 模式缺地址池时报警', () => {
    expect(validateDnsSettings({ ...SAMPLE, fakeIpRange: '' })).toEqual(
      expect.arrayContaining([expect.stringContaining('fake-ip')])
    )
  })

  it('合法配置无问题', () => {
    expect(validateDnsSettings(SAMPLE)).toHaveLength(0)
  })
})

describe('listDnsPresetMetas', () => {
  it('返回内置预设元信息', () => {
    const metas = listDnsPresetMetas()
    expect(metas.length).toBeGreaterThan(0)
    expect(metas[0]).toHaveProperty('id')
    expect(metas[0]).toHaveProperty('name')
  })
})

describe('buildDnsBlock snapshot', () => {
  it('生成可被 yaml 解析的文本', async () => {
    const { default: yaml } = await import('js-yaml')
    const text = buildDnsBlock(SAMPLE)
    const parsed = yaml.load(text) as Record<string, unknown>
    expect(parsed.dns).toMatchObject({ enable: true, 'enhanced-mode': 'fake-ip' })
  })
})