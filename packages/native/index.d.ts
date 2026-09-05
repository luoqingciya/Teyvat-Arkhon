export interface MihomoNative {
  /** 加载 libmihomo 共享库并解析 C ABI 符号 */
  load(libPath: string): boolean
  /** 返回内核版本字符串 */
  version(): string
  /** 从配置文件启动核心 */
  start(configPath: string): void
  /** 停止核心 */
  stop(): void
  /** 热重载配置 */
  reload(configPath: string): void
}

export declare function resolveBindingPath(custom?: string): string | null
export declare function tryLoad(): MihomoNative | null