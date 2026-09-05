/**
 * Teyvat Arkhon - Mihomo FFI 绑定（N-API 原生模块）
 *
 * 职责：
 *  1. 动态加载 libmihomo（Linux .so / macOS .dylib / Windows .dll）
 *  2. 解析 mihomo_bridge.h 定义的 C ABI 符号
 *  3. 向 JS 层暴露 load/version/start/stop/reload
 *
 * 本模块是"FFI 直连架构"在 Node 侧的唯一入口，
 * 随后 TUN 驱动管理、系统服务安装等底层能力也将在此模块补充。
 */

#include <napi.h>
#include <vector>
#include <string>

#include "mihomo_bridge.h"

#ifdef _WIN32
#  include <windows.h>
typedef HMODULE lib_handle_t;
#  define LOAD_LIBRARY(name) LoadLibraryA(name)
#  define GET_SYMBOL(handle, name) GetProcAddress(handle, name)
#  define FREE_LIBRARY(handle) FreeLibrary(handle)
#else
#  include <dlfcn.h>
typedef void* lib_handle_t;
#  define LOAD_LIBRARY(name) dlopen(name, RTLD_NOW | RTLD_LOCAL)
#  define GET_SYMBOL(handle, name) dlsym(handle, name)
#  define FREE_LIBRARY(handle) dlclose(handle)
#endif

static lib_handle_t g_lib = nullptr;
static mihomo_bridge_t g_bridge = {};

[[noreturn]] static void throw_js_error(Napi::Env env, const std::string& message) {
  Napi::Error::New(env, message).ThrowAsJavaScriptException();
}

/** JS: mihomo.load(libPath: string) -> boolean */
static Napi::Value load(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    throw_js_error(env, "load: 参数 libPath 必须是字符串");
    return env.Undefined();
  }
  const std::string lib_path = info[0].As<Napi::String>().Utf8Value();

  lib_handle_t handle = LOAD_LIBRARY(lib_path.c_str());
  if (!handle) {
#ifdef _WIN32
    const DWORD err = GetLastError();
    throw_js_error(env, "加载 libmihomo 失败: " + lib_path + " (WinErr " + std::to_string(err) + ")");
#else
    throw_js_error(env, "加载 libmihomo 失败: " + lib_path + " (" + dlerror() + ")");
#endif
    return env.Undefined();
  }

  mihomo_bridge_t bridge = {};
  bridge.version = reinterpret_cast<mihomo_bridge_version_fn>(GET_SYMBOL(handle, "mihomo_bridge_version"));
  bridge.start = reinterpret_cast<mihomo_bridge_start_fn>(GET_SYMBOL(handle, "mihomo_bridge_start"));
  bridge.stop = reinterpret_cast<mihomo_bridge_stop_fn>(GET_SYMBOL(handle, "mihomo_bridge_stop"));
  bridge.reload = reinterpret_cast<mihomo_bridge_reload_fn>(GET_SYMBOL(handle, "mihomo_bridge_reload"));
  bridge.last_error = reinterpret_cast<mihomo_bridge_last_error_fn>(GET_SYMBOL(handle, "mihomo_bridge_last_error"));
  bridge.free_str = reinterpret_cast<mihomo_bridge_free_fn>(GET_SYMBOL(handle, "mihomo_bridge_free"));

  if (!bridge.version || !bridge.start || !bridge.stop || !bridge.reload) {
#ifdef _WIN32
    FREE_LIBRARY(handle);
#else
    dlclose(handle);
#endif
    throw_js_error(env, "libmihomo 缺少必要符号，请确认其由 bridge/mihomo_bridge.go 编译 (ABI 版本不匹配)");
    return env.Undefined();
  }

  g_lib = handle;
  g_bridge = bridge;
  return Napi::Boolean::New(env, true);
}

/** JS: mihomo.version() -> string */
static Napi::Value version(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_lib) {
    throw_js_error(env, "version: 尚未调用 mihomo.load()");
    return env.Undefined();
  }
  const char* raw = g_bridge.version();
  std::string out = raw ? raw : "";
  if (g_bridge.free_str && raw) g_bridge.free_str(raw);
  return Napi::String::New(env, out);
}

/** JS: mihomo.start(configPath: string) -> void */
static Napi::Value start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_lib) {
    throw_js_error(env, "start: 尚未调用 mihomo.load()");
    return env.Undefined();
  }
  const std::string config = info[0].As<Napi::String>().Utf8Value();
  const int rc = g_bridge.start(config.c_str());
  if (rc != 0) {
    std::string err = g_bridge.last_error ? g_bridge.last_error() : "unknown error";
    throw_js_error(env, "mihomo start 失败(" + std::to_string(rc) + "): " + err);
    return env.Undefined();
  }
  return env.Undefined();
}

/** JS: mihomo.stop() -> void */
static Napi::Value stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_lib) {
    throw_js_error(env, "stop: 尚未调用 mihomo.load()");
    return env.Undefined();
  }
  const int rc = g_bridge.stop();
  if (rc != 0) {
    std::string err = g_bridge.last_error ? g_bridge.last_error() : "unknown error";
    throw_js_error(env, "mihomo stop 失败(" + std::to_string(rc) + "): " + err);
    return env.Undefined();
  }
  return env.Undefined();
}

/** JS: mihomo.reload(configPath: string) -> void */
static Napi::Value reload(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_lib) {
    throw_js_error(env, "reload: 尚未调用 mihomo.load()");
    return env.Undefined();
  }
  const std::string config = info[0].As<Napi::String>().Utf8Value();
  const int rc = g_bridge.reload(config.c_str());
  if (rc != 0) {
    std::string err = g_bridge.last_error ? g_bridge.last_error() : "unknown error";
    throw_js_error(env, "mihomo reload 失败(" + std::to_string(rc) + "): " + err);
    return env.Undefined();
  }
  return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("load", Napi::Function::New(env, load));
  exports.Set("version", Napi::Function::New(env, version));
  exports.Set("start", Napi::Function::New(env, start));
  exports.Set("stop", Napi::Function::New(env, stop));
  exports.Set("reload", Napi::Function::New(env, reload));
  return exports;
}

NODE_API_MODULE(mihomo_binding, Init)