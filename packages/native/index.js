'use strict'

const path = require('node:path')

/**
 * 解析原生绑定 .node 文件的路径。
 * @param {string} [custom] 显式指定 .node 路径（打包环境由外层传入）
 * @returns {string|null}
 */
function resolveBindingPath(custom) {
  if (custom && typeof custom === 'string') return custom
  const candidates = [
    path.join(__dirname, 'bin', `mihomo_binding-${process.platform}-${process.arch}.node`),
    path.join(__dirname, 'bin', 'mihomo_binding.node'),
    path.join(__dirname, 'build', 'Release', 'mihomo_binding.node'),
    path.join(__dirname, 'build', 'Debug', 'mihomo_binding.node')
  ]
  return candidates.find((p) => {
    try {
      require.resolve(p)
      return true
    } catch {
      return false
    }
  }) ?? null
}

/** 加载原生模块（失败返回 null，不抛出，便于无工具链环境下回退到进程驱动） */
function tryLoad() {
  const bindingPath = resolveBindingPath()
  if (!bindingPath) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(bindingPath)
  } catch {
    return null
  }
}

module.exports = { resolveBindingPath, tryLoad }