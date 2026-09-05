/* FFI 链路冒烟测试（临时）：addon → libmihomo.dll → 内核启停 + REST 数据面 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = 'd:/Project/Teyvat-Arkhon'
const native = require(path.join(ROOT, 'packages/native/bin/mihomo_binding.node'))
const LIBMIHOMO = path.join(ROOT, 'packages/native/bridge/libmihomo.dll')

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhon-ffi-'))
const cfgPath = path.join(workDir, 'config.yaml')
fs.writeFileSync(
  cfgPath,
  [
    'mixed-port: 17891',
    'external-controller: 127.0.0.1:19091',
    'allow-lan: false',
    'mode: rule',
    'log-level: silent',
    'proxies: []',
    'proxy-groups: []',
    'rules: []',
    ''
  ].join('\n'),
  'utf-8'
)

function get(pathName) {
  return fetch(`http://127.0.0.1:19091${pathName}`).then((r) => r.json())
}

async function main() {
  console.log('[1] load libmihomo ...')
  console.log('[1] load =', native.load(LIBMIHOMO))
  console.log('[2] version =', native.version())

  console.log('[3] start core with config ...')
  native.start(cfgPath)
  console.log('[3] start ok')

  // 等待 REST 就绪
  await new Promise((r) => setTimeout(r, 800))

  console.log('[4] REST /version =', await get('/version'))
  const proxies = await get('/proxies')
  console.log('[4] REST /proxies keys =', Object.keys(proxies.proxies || {}).slice(0, 5))

  console.log('[5] reload config ...')
  native.reload(cfgPath)
  console.log('[5] reload ok')

  console.log('[6] stop core ...')
  native.stop()
  console.log('[6] stop ok')

  const after = await fetch('http://127.0.0.1:19091/version').then((r) => 'alive').catch(() => 'down')
  console.log('[7] controller after stop =', after)
  console.log('ALL OK')
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
  } catch {
    // 内核已 chdir 进该目录，清理失败可忽略
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('FFI TEST FAILED:', e)
  process.exit(1)
})