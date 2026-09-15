/**
 * IPC 参数清洗：Vue 3 reactive Proxy 无法被 Electron contextBridge 结构化克隆
 * （在参数进入 preload 之前就抛 "An object could not be cloned"）。
 * 组件调用 `window.arkhon.*` 传对象/数组参数前必须先用本函数转为纯 JSON。
 */
export function plain<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v)) as T
}