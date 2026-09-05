/**
 * 幂等修补 cmake-js：/DELAYLOAD:NODE.EXE 链接标志仅限 Visual Studio 生成器使用，
 * MinGW/GNU ld 不识别会导致链接失败。CI 与本地在 pnpm install 后执行一次。
 * 用法: node scripts/patch-cmake-js.mjs
 */
'use strict'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const MARKER = '[teyvat-arkhon patch] MSVC'
const candidates = [
  'node_modules/cmake-js/lib/toolset.js',
  'packages/native/node_modules/cmake-js/lib/toolset.js'
]
const toolsetPath = candidates.find((p) => existsSync(p))

if (!toolsetPath) {
  console.warn('[patch-cmake-js] 未找到 cmake-js toolset.js，跳过（可能未安装 cmake-js）')
  process.exit(0)
}

const src = readFileSync(toolsetPath, 'utf-8')
if (src.includes(MARKER)) {
  console.log('[patch-cmake-js] 已打过补丁，跳过')
  process.exit(0)
}

const oldBlock = `this.linkerFlags.push('/DELAYLOAD:NODE.EXE')`
if (!src.includes(oldBlock)) {
  console.warn('[patch-cmake-js] 未匹配到注入点，跳过（cmake-js 版本结构变更）')
  process.exit(0)
}

const newBlock = `// ${MARKER} 专属链接标志仅在使用 Visual Studio 生成器时生效；MinGW/GNU ld 不识别 /DELAYLOAD
if (!this.options.generator || this.options.generator.includes('Visual Studio')) {
  this.linkerFlags.push('/DELAYLOAD:NODE.EXE')
}`

writeFileSync(toolsetPath, src.replace(oldBlock, newBlock), 'utf-8')
console.log('[patch-cmake-js] 补丁已应用')