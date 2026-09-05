/**
 * Mihomo 原生桥接的 C ABI 契约。
 *
 * libmihomo（由 bridge/mihomo_bridge.go 通过 cgo -buildmode=c-shared 编译生成）
 * 必须导出以下符号。C++ 侧通过系统动态加载器（LoadLibrary/dlopen）按名解析，
 * 全部调用均为进程内同步调用，零网络开销。
 */
#ifndef TEYVAT_ARKHON_MIHOMO_BRIDGE_H_
#define TEYVAT_ARKHON_MIHOMO_BRIDGE_H_

#ifdef __cplusplus
extern "C" {
#endif

/* 返回当前内核版本号字符串。内存由 Go 侧分配，调用方须用 mihomo_bridge_free 释放。 */
typedef const char* (*mihomo_bridge_version_fn)(void);

/* 从指定配置文件启动核心。0 成功，非 0 失败（用 mihomo_bridge_last_error 查看原因）。 */
typedef int (*mihomo_bridge_start_fn)(const char* config_path);

/* 停止核心（含清理 TUN 等资源）。0 成功。 */
typedef int (*mihomo_bridge_stop_fn)(void);

/* 已运行状态下重新加载配置文件。0 成功。 */
typedef int (*mihomo_bridge_reload_fn)(const char* config_path);

/* 最近一次错误的描述字符串。指针生命周期截止到下一次调用。 */
typedef const char* (*mihomo_bridge_last_error_fn)(void);

/* 释放由本桥接库返回的 C 字符串。 */
typedef void (*mihomo_bridge_free_fn)(const char* str);

typedef struct mihomo_bridge_t {
  mihomo_bridge_version_fn version;
  mihomo_bridge_start_fn start;
  mihomo_bridge_stop_fn stop;
  mihomo_bridge_reload_fn reload;
  mihomo_bridge_last_error_fn last_error;
  mihomo_bridge_free_fn free_str;
} mihomo_bridge_t;

#ifdef __cplusplus
}
#endif

#endif  // TEYVAT_ARKHON_MIHOMO_BRIDGE_H_