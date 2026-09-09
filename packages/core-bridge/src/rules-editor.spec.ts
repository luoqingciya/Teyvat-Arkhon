import { describe, it, expect } from 'vitest'
import {
  applyRulesToConfig,
  debugRulesMatch,
  parseProvidersMap,
  parseRuleText,
  parseRulesArray,
  providersToMap,
  ruleToText,
  strategyNamesOfSummary,
  validateRule,
  validateRules
} from './rules-editor'
import type { RuleProvider } from '@teyvat-arkhon/shared'

describe('parseRuleText', () => {
  it('解析三段规则（DOMAIN-SUFFIX）', () => {
    expect(parseRuleText('DOMAIN-SUFFIX,example.com,Proxy')).toEqual({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      proxy: 'Proxy'
    })
  })

  it('MATCH 无中间段时 payload 为空', () => {
    expect(parseRuleText('MATCH,DIRECT')).toEqual({ type: 'MATCH', payload: '', proxy: 'DIRECT' })
  })

  it('注释与空行返回 null', () => {
    expect(parseRuleText('# comment')).toBeNull()
    expect(parseRuleText('')).toBeNull()
  })

  it('未知类型返回 null', () => {
    expect(parseRuleText('FOO,bar,baz')).toBeNull()
  })

  it('忽略首尾空白与大小写类型', () => {
    expect(parseRuleText('  domain-suffix,Example.COM,Proxy  ')).toEqual({
      type: 'DOMAIN-SUFFIX',
      payload: 'Example.COM',
      proxy: 'Proxy'
    })
  })
})

describe('ruleToText / parseRulesArray', () => {
  it('MATCH 只序列化两段', () => {
    expect(ruleToText({ type: 'MATCH', payload: '', proxy: 'DIRECT' })).toBe('MATCH,DIRECT')
  })

  it('普通规则三色序列化，过滤非法元素', () => {
    expect(parseRulesArray(['DOMAIN-SUFFIX,example.com,Proxy', 'MATCH,DIRECT', '# comment', 42])).toEqual([
      { type: 'DOMAIN-SUFFIX', payload: 'example.com', proxy: 'Proxy' },
      { type: 'MATCH', payload: '', proxy: 'DIRECT' }
    ])
  })
})

describe('parseProvidersMap / providersToMap', () => {
  it('解析 rule-providers 映射（http 与 file）', () => {
    const map = {
      adblock: { type: 'http', behavior: 'domain', url: 'https://x/a.yaml', interval: 60 },
      cn: { type: 'file', behavior: 'ipcidr', path: './cn.yaml' }
    }
    const list = parseProvidersMap(map)
    expect(list).toContainEqual({
      name: 'adblock',
      type: 'http',
      behavior: 'domain',
      url: 'https://x/a.yaml',
      interval: 60
    })
    expect(list).toContainEqual({
      name: 'cn',
      type: 'file',
      behavior: 'ipcidr',
      file: './cn.yaml'
    })
  })

  it('providersToMap 往返保持字段', () => {
    const list: RuleProvider[] = [{ name: 'p', type: 'http', behavior: 'domain', url: 'https://x/b', interval: 30 }]
    const map = providersToMap(list)
    expect(map.p).toEqual({ type: 'http', behavior: 'domain', url: 'https://x/b', interval: 30 })
  })
})

describe('validateRule / validateRules', () => {
  const strategies = new Set(['DIRECT', 'REJECT', 'PROXY'])

  it('策略存在于内置或节点/组集合时通过', () => {
    expect(validateRule({ type: 'DOMAIN-SUFFIX', payload: 'a.com', proxy: 'PROXY' }, strategies).ok).toBe(true)
    expect(validateRule({ type: 'MATCH', payload: '', proxy: 'DIRECT' }, strategies).ok).toBe(true)
  })

  it('缺失类型 / payload / 策略时给出中文错误', () => {
    expect(validateRule({ type: '', payload: '', proxy: '' }, strategies).message).toBe('规则类型为空')
    expect(validateRule({ type: 'DOMAIN-KEYWORD', payload: '', proxy: 'DIRECT' }, strategies).message).toContain('缺少匹配目标')
    expect(validateRule({ type: 'DOMAIN', payload: 'a.com', proxy: 'NOPE' }, strategies).message).toContain('策略不存在')
  })

  it('未知类型报错', () => {
    expect(validateRule({ type: 'BOGUS', payload: 'x', proxy: 'DIRECT' }, strategies).message).toContain('未知规则类型')
  })

  it('MATCH 非末位时给温馨提示但不拦截', () => {
    const list = [
      { type: 'DOMAIN-SUFFIX', payload: 'a.com', proxy: 'DIRECT' },
      { type: 'MATCH', payload: '', proxy: 'DIRECT' },
      { type: 'DOMAIN-KEYWORD', payload: 'ads', proxy: 'REJECT' }
    ]
    const v = validateRules(list, strategies)
    expect(v[1].ok).toBe(true)
    expect(v[1].message).toContain('MATCH')
  })
})

describe('strategyNamesOfSummary', () => {
  it('合并内置策略 + proxies + groups 名称', () => {
    const set = strategyNamesOfSummary({
      proxies: [{ name: 'HK', type: 'ss' }],
      proxyGroups: [{ name: 'PROXY', type: 'select' }]
    })
    expect(set.has('DIRECT')).toBe(true)
    expect(set.has('HK')).toBe(true)
    expect(set.has('PROXY')).toBe(true)
  })
})

describe('debugRulesMatch', () => {
  const rules = [
    { type: 'DOMAIN-SUFFIX', payload: 'netflix.com', proxy: 'PROXY' },
    { type: 'IP-CIDR', payload: '10.0.0.0/8', proxy: 'DIRECT' },
    { type: 'GEOIP', payload: 'CN', proxy: 'DIRECT' },
    { type: 'MATCH', payload: '', proxy: 'PROXY' }
  ]

  it('命中 DOMAIN-SUFFIX 并立即中断', () => {
    const res = debugRulesMatch('www.netflix.com', rules)
    expect(res.matched).toEqual({ type: 'DOMAIN-SUFFIX', payload: 'netflix.com', proxy: 'PROXY' })
    expect(res.steps[0].matched).toBe(true)
  })

  it('命中 IP-CIDR', () => {
    const res = debugRulesMatch('10.1.2.3', rules)
    expect(res.matched?.type).toBe('IP-CIDR')
  })

  it('IP-CIDR 网段外不命中，交给后续规则', () => {
    const res = debugRulesMatch('8.8.8.8', rules)
    expect(res.steps[1].matched).toBe(false)
    expect(res.matched?.type).toBe('MATCH')
  })

  it('GEOIP/GEOSITE 标注需内核数据，不产生错误', () => {
    const res = debugRulesMatch('cn.example.com', rules)
    expect(res.steps[2].reason).toContain('geoip')
    expect(res.steps[2].matched).toBe(false)
  })

  it('最终由 MATCH 兜底', () => {
    const res = debugRulesMatch('whatever.org', rules)
    expect(res.matched?.type).toBe('MATCH')
    expect(res.steps.length).toBe(4)
  })
})

describe('applyRulesToConfig', () => {
  it('替换既有 rules 块并保留其它内容', () => {
    const raw = `mode: rule\nproxies:\n  - {name: HK, server: 1.2.3.4}\nrules:\n  - MATCH,DIRECT\n`
    const { text, patchedRules } = applyRulesToConfig(raw, [{ type: 'MATCH', payload: '', proxy: 'PROXY' }], [])
    expect(patchedRules).toBe(true)
    expect(text).toContain('mode: rule')
    expect(text).toContain('proxies:\n  - {name: HK')
    expect(text).toContain('rules:\n  - MATCH,PROXY')
    expect(text).not.toContain('MATCH,DIRECT')
  })

  it('缺失 rules 时追加到末尾', () => {
    const raw = `mode: rule\nproxies: []\n`
    const { text, patchedRules } = applyRulesToConfig(raw, [{ type: 'MATCH', payload: '', proxy: 'DIRECT' }], [])
    expect(patchedRules).toBe(false)
    expect(text).toContain('rules:\n  - MATCH,DIRECT')
  })

  it('写入 rule-providers 并保持缩进', () => {
    const providers: RuleProvider[] = [
      { name: 'ad', type: 'http', behavior: 'domain', url: 'https://x/a.yaml', interval: 60 }
    ]
    const { text } = applyRulesToConfig(`mode: rule\nrules:\n  - MATCH,DIRECT\n`, [], providers)
    expect(text).toContain('rule-providers:')
    expect(text).toContain('  ad:')
    expect(text).toContain('    url: https://x/a.yaml')
    expect(text).not.toContain('rule-providers: {}')
  })
})