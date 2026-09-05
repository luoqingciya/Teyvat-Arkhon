/**
 * E2E：通过 CoreService（FFI 驱动）+ 本地测试上游，验证完整代理链路。
 * 订阅导入 → 切换档案 → TUN 配置开关 → 启动内核 → 切换节点 → 规则路由 →
 * 流量数据面（/connections 累计）→ 热重载。
 *
 * 说明：mihomo v1.19 的 http 代理适配器使用 CONNECT 隧道，因此本地上游把
 * 任意 CONNECT 目标隧道到本地回显服务；/big 路径返回 256KB 用于流量断言。
 *
 * 用法: node scripts/e2e-core.cjs（需先完成 libmihomo.dll + mihomo_binding.node 构建）
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const net = require('node:net')

const ROOT = path.resolve(__dirname, '..')
const bridge = require(path.join(ROOT, 'packages/core-bridge/dist/index.js'))

const LIBMIHOMO = path.join(ROOT, 'apps/electron/resources/core/libmihomo.dll')
const BINDING = path.join(ROOT, 'packages/native/bin/mihomo_binding.node')

const MIXED_PORT = 17892
const CONTROLLER = '127.0.0.1:19092'
const UPSTREAM_PORT = 19999
const ECHO_PORT = 19099

const YAML = `mixed-port: ${MIXED_PORT}
external-controller: ${CONTROLLER}
allow-lan: false
mode: rule
log-level: info
geodata-mode: true
proxies:
  - name: "LOCAL-UP"
    type: http
    server: 127.0.0.1
    port: ${UPSTREAM_PORT}
proxy-groups:
  - name: PROXY
    type: select
    proxies: [LOCAL-UP, DIRECT]
rules:
  - DOMAIN-SUFFIX,test,PROXY
  - GEOIP,CN,DIRECT
  - MATCH,DIRECT
`

let checks = 0
let failed = 0
function ok(name) {
  checks++
  console.log(`  ✓ ${name}`)
}
function check(cond, name, detail) {
  if (cond) ok(name)
  else {
    failed++
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`)
  }
}

/** 本地"上游代理"：绝对形式 GET 应答；CONNECT 隧道到本地回显（模拟远端可达） */
function startUpstream(echoPort) {
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url)
      console.log('   [upstream] 绝对形式 GET:', u.host, u.pathname)
      res.writeHead(200, { 'content-type': 'text/plain', 'x-upstream': 'true' })
      res.end(`UPSTREAM-OK ${u.pathname}`)
    } catch {
      res.writeHead(400)
      res.end('bad')
    }
  })
  srv.on('connect', (req, socket) => {
    const target = net.connect(echoPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      target.pipe(socket)
      socket.pipe(target)
    })
    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
  })
  srv.listen(UPSTREAM_PORT, '127.0.0.1')
  return srv
}

/** 本地回显 server：/big 返回 256KB（流量断言），其余路径返回标记 */
function startEcho() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200)
    if (req.url === '/big') {
      res.end(Buffer.alloc(256 * 1024, 0x62))
    } else {
      res.end(`ECHO-OK ${req.url}`)
    }
  })
  srv.listen(ECHO_PORT, '127.0.0.1')
  return srv
}

/** 直连内核 mixed 端口发起请求（绝对形式，模拟系统代理请求） */
function requestThroughCore(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({
      host: '127.0.0.1',
      port: MIXED_PORT,
      method: 'GET',
      path: url,
      headers: { host: u.host }
    })
    req.on('response', (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.setTimeout(8000, () => req.destroy(new Error('core 响应超时')))
    req.end()
  })
}

async function main() {
  console.log('== Teyvat Arkhon E2E (FFI 直连 + 本地上游，阶段二) ==\n')

  if (!fs.existsSync(LIBMIHOMO) || !fs.existsSync(BINDING)) {
    console.error('缺少 libmihomo.dll 或 mihomo_binding.node')
    process.exit(1)
  }

  const echo = startEcho()
  const upstream = startUpstream(ECHO_PORT)
  await new Promise((r) => setTimeout(r, 300))

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhon-e2e-'))
  const svc = new bridge.CoreService({
    profilesDir: path.join(userData, 'profiles'),
    activeConfigFile: path.join(userData, 'config', 'config.yaml'),
    driver: { mode: 'ffi', options: { libPath: LIBMIHOMO, bindingPath: BINDING } }
  })

  try {
    await svc.init()
    ok('初始化配置目录')

    const { profile } = await svc.importFromText('demo-sub', YAML)
    ok('导入订阅（含 GEOIP 规则，验证 geo 数据可用）')
    await svc.selectProfile(profile.id)
    ok('切换档案（写入工作配置 config.yaml）')

    // TUN 配置开关（启动前，纯配置级）
    const tunOn = await svc.setTunEnabled(true)
    check(tunOn.tunEnabled === true, 'TUN 配置已写入工作配置')
    await svc.setTunEnabled(false)
    check(!(await svc.getTunEnabled()), 'TUN 配置可关闭')

    const status = await svc.start()
    check(status.driver === 'ffi', '驱动为 FFI 直连', `actual=${status.driver}`)
    check(status.state === 'running', '内核运行状态=running')
    ok(`内核版本 ${status.version && status.version.version}`)

    const proxies = await svc.listProxies()
    const group = proxies.find((p) => p.name === 'PROXY')
    check(!!group, 'REST 数据面返回策略组 PROXY')
    check(proxies.some((p) => p.name === 'LOCAL-UP'), '列表包含 LOCAL-UP 节点')
    check(group && group.now === 'LOCAL-UP', 'PROXY 组当前选中 LOCAL-UP')

    // 规则 DOMAIN-SUFFIX,test → PROXY → 上游（CONNECT 隧道）
    const viaProxy = await requestThroughCore('http://foo.test/tunnel-probe')
    check(viaProxy.status === 200, '命中 PROXY 规则的请求返回 200', `status=${viaProxy.status} body=${viaProxy.body}`)
    check(/\/tunnel-probe/.test(viaProxy.body), '流量经本地上游中转（标记命中）', `body=${viaProxy.body}`)

    // 规则 MATCH,DIRECT → 直连回显
    const viaDirect = await requestThroughCore(`http://127.0.0.1:${ECHO_PORT}/direct-probe`)
    check(/ECHO-OK[\s\S]*\/direct-probe/.test(viaDirect.body), 'MATCH,DIRECT 直连生效（标记命中）', `body=${viaDirect.body}`)

    // 流量数据面：拉取 256KB 后累计 downloadTotal 应增长
    await requestThroughCore(`http://127.0.0.1:${ECHO_PORT}/big`)
    const flow = await svc.getConnections()
    check(flow.downloadTotal >= 256 * 1024, '流量累计正确（downloadTotal >= 256KB）', `downloadTotal=${flow.downloadTotal}`)
    check(Array.isArray(flow.connections), '活跃连接列表可读（connections 数组）')

    // 热重载：导入第二个档案并切换
    const { profile: p2 } = await svc.importFromText('demo-sub-2', YAML)
    await svc.selectProfile(p2.id)
    check(svc.status().state === 'running', '切换档案后内核仍运行（热重载生效）')
  } finally {
    await svc.stop().catch(() => {})
    upstream.close()
    echo.close()
    try {
      fs.rmSync(userData, { recursive: true, force: true })
    } catch {
      /* 内核 chdir 占用目录，忽略 */
    }
  }

  console.log(`\n== E2E 结果: 通过 ${checks} 项` + (failed ? `，失败 ${failed} 项 ==` : '，全部通过 =='))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E FAILED:', e)
  process.exit(1)
})