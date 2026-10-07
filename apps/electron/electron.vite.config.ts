import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

/**
 * 生产构建注入 Content-Security-Policy（`apply: 'build'`，开发期不注入）。
 *
 * 为什么只在生产注入：开发期渲染端由 Vite dev server 提供，HMR 依赖 WebSocket
 * 与内联脚本，严格 CSP 会直接打断开发体验；而开发期不构成威胁面。
 *
 * 为什么用 meta 而不是 webRequest 响应头：打包后渲染端经 `loadFile` 走 `file://`，
 * Electron 的 webRequest 不拦截 file:// 请求，响应头方案在生产环境会静默失效。
 * 另注：`frame-ancestors` / `report-uri` / `sandbox` 经 meta 投递会被浏览器忽略，
 * 故不在此列出（本应用不嵌入 iframe，无需 frame-ancestors）。
 */
const CSP_POLICY = [
  "default-src 'self'",
  // 渲染端脚本全部来自打包产物（无内联脚本、无 eval）
  "script-src 'self'",
  // Vue scoped 样式经打包产出；CodeMirror 6 运行时注入 <style>，故需 inline
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // 渲染端不直连网络（订阅/测速/自检全部经 IPC 交主进程），故仅允许 self
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'arkhon-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_POLICY },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    // 依赖默认 externalize：工作区包经运行时 node_modules 解析
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    plugins: [vue(), cspPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})