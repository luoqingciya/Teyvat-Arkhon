<div align="center">

# Teyvat Arkhon（提瓦特方舟）

基于 **Electron + C/C++** 的跨平台网络代理客户端，通过 FFI 直接内嵌 **[Mihomo](https://github.com/MetaCubeX/mihomo)（Clash Meta）** 核心，提供高性能、低延迟、支持 TUN 与系统服务托管的专业级代理方案。

[![CI](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/ci.yml/badge.svg)](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-GitHub%20Actions-blue)](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/release.yml)
[![Download](https://img.shields.io/badge/download-Releases-green)](https://github.com/luoqingciya/Teyvat-Arkhon/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-green)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31-47848F)](https://www.electronjs.org)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D)](https://vuejs.org)

> 当前预发布版本：**v0.9.0-rc**（Windows 安装版 / 免安装 zip · Linux AppImage / deb）

</div>

---

## 📖 目录

- [特性总览](#-特性总览)
- [快速上手](#-快速上手)
- [架构](#-架构)
- [功能导览](#-功能导览)
- [开发指南](#-开发指南)
- [订阅格式支持](#-订阅格式支持)
- [常见问题 FAQ](#-常见问题-faq)
- [已知限制](#-已知限制)
- [打包与发布](#-打包与发布)
- [许可证与合规](#-许可证与合规)

---

## ✨ 特性总览

**内核与链路**

- **FFI 直连架构**：主进程经 N-API 加载 `libmihomo`（由 cgo `-buildmode=c-shared` 编译的共享库），启动/停止/热重载/版本等控制面均为**进程内同步调用，零网络开销**；数据面（节点、连接、延迟）复用内核内建 `external-controller` REST API。
- **进程驱动回退**：未探测到原生链路（无 `libmihomo` 或 `.node`）时自动切换为 sidecar 模式——spawn mihomo 二进制 + RESTful API，功能等价，方便无工具链环境与 CI 使用。

**订阅与代理**

- **订阅管理**：URL 或粘贴文本导入（自动 Base64 解码），同页切换/刷新/删除，导入即校验（YAML 解析 + 最小合法性检查）。
- **策略组操作**：策略组切换、单节点测速、**批量测速**（顺序执行，逐行反馈进度）。
- **实时监控**：下载/上传瞬时速率曲线、累计流量、活跃连接列表（目标/类型/上下行/规则/进程），连接可**单独关闭或全部断开**。

**系统能力**

- **系统代理**：Windows（注册表）/ macOS（networksetup）/ Linux（gsettings）一键开启/关闭，端口与内核 `mixed-port` 联动。
- **TUN 模式**：透明代理接管全局流量（含不遵守系统代理的软件）；Windows 依赖 Wintun 驱动，配置级开关 + 热重载。
- **Windows 服务托管**：将内核注册为开机自启服务（进程驱动模式），实现"免打开应用常驻"；无需常驻时随时卸载。

**编辑与体验**

- **配置编辑器**：CodeMirror 6 YAML 语法高亮；保存前校验、内核运行中自动热重载。
- **主题 & 国际化**：亮/暗双主题（暗色为提瓦特基调，玻璃拟态质感）；简体中文 / English 即时切换，偏好持久化。
- **自动更新**：基于 GitHub Releases 的 electron-updater，后台静默下载、退出时安装（可用环境变量跳过）。
- **便携模式**：数据（订阅档案、工作配置、geo/wintun）默认存于系统用户目录；开启便携后全部跟随运行目录（绿色版体验）。

---

## 🚀 快速上手

1. **获取应用**：从 [Releases](https://github.com/luoqingciya/Teyvat-Arkhon/releases) 下载对应产物 —— **Windows**：NSIS 安装版（`.exe`）或 **免安装 zip 版**（`.zip`，解压即用）；**Linux**：AppImage 或 deb。
2. **导入订阅**：打开应用 →「订阅」页 → 粘贴 Clash 订阅链接或完整 YAML 配置 → 导入。
3. **启动内核**：回到「总览」页点击 **启动内核**；在「代理」页选择节点并测速；如需全局接管可开启「系统代理」或「TUN」。

> 提示：TUN 模式需要管理员权限；Windows 下若缺少 `wintun.dll`，请手动放入 `resources/core` 或内核工作目录。
>
> 提示：**zip 免安装版**默认数据存系统用户目录；想要"解压到哪、数据在哪"的绿色体验，在解压目录放一个空的 `portable.txt`（或设环境变量 `TEVVAT_ARKHON_PORTABLE=1`）即可开启便携模式，订阅/配置/geo 全部跟随目录。

---

## 🏗 架构

### 进程与数据流

```
┌───────────────────────────── Electron 应用 ────────────────────────────┐
│  Renderer (Vue3 + Pinia + i18next + CodeMirror)                        │
│    ▲ IPC invoke (window.arkhon)          ▲ 事件推流 (1s 状态/流量)       │
│  Preload (contextBridge)                                              │
│    ▲ ipcMain.handle                                                  │
│  Main Process ────────────────┬───────────────┴─ TrafficMonitor        │
│    CoreService                │                SystemProxy / Service   │
│      ├─ FFICoreDriver ──────► │ N-API (.node)                          │
│      │        libmihomo (cgo c-shared) ◄── LoadLibrary                 │
│      │           ▲ 进程内同步 ── Mihomo 内核（含 external-controller）    │
│      │           └─────────────── RESTful API（数据面：proxies/connections）│
│      └─ ProcessCoreDriver ──► spawn mihomo.exe + REST（开发回退）        │
└────────────────────────────────────────────────────────────────────────┘
```

- **控制面**（start/stop/reload/version）：FFI 进程内 C ABI 调用，见 `packages/native/src/mihomo_bridge.h` 的 `mihomo_bridge_*` 符号契约。
- **数据面**（proxies/connections/delay/configs）：内核 `external-controller` REST API，端口与密钥取自当前工作配置。
- **驱动自动选择**：应用启动时探测 `libmihomo` 与 `.node` 是否齐全，齐全走 FFI，否则进程驱动；状态栏实时显示当前驱动模式。

### 运行时数据布局

| 数据 | 默认位置 | 便携模式 |
| --- | --- | --- |
| 订阅档案 / 工作配置 `config.yaml` | `%APPDATA%\<app>`（系统用户目录） | `运行目录/data` |
| geo 数据（geoip/geosite） | `~/.config/mihomo` | `运行目录/data/mihomo` |
| wintun 驱动 | 数据目录 `config/` | 同上 |
| 系统代理 / 服务注册 | 系统级（注册表 / sc） | 不随便携 |

> 便携模式开启方式：设置页「数据与便携」一键切换（写入/删除 `portable.txt`，重启生效），或设置环境变量 `TEVVAT_ARKHON_PORTABLE=1`。

---

## 🖥 功能导览

| 页面 | 功能 |
| --- | --- |
| **总览** | 内核启停（大按钮）、运行状态/驱动模式/版本、系统代理开关、实时流量卡片（速率曲线+连接数+累计）、快速开始 |
| **代理** | 策略组切换（chips）、节点表格（类型/延迟）、单点测速、批量测速（带进度）、选中高亮 |
| **订阅** | URL 导入、文本导入（textarea）、档案列表（使用中/刷新/删除/切换） |
| **连接** | 活跃连接表格（1s 刷新）、单条关闭、全部断开、累计流量总览 |
| **配置** | CodeMirror YAML 编辑、保存即校验 + 热重载、校验失败回显错误 |
| **设置** | TUN 开关、主题（亮/暗）、语言（zh/en）、数据目录与便携开关、系统服务（安装/卸载/状态）、关于（版本/许可证） |
| **状态栏** | 内核状态灯、驱动模式、内核版本、连接数胶囊、错误提示 |

---

## 🛠 开发指南

### 环境要求

- Node.js ≥ 22.13、pnpm 11（monorepo workspace + strict 布局）
- 构建/运行**原生链路**需要：Go（cgo）与 gcc —— Windows 推荐 [MinGW-w64](https://www.mingw-w64.org/)（MSVC 组件不参与 cgo），macOS / Linux 用系统 `gcc`/`clang`
- 打包需要 electron-builder 依赖（CI 已内置）

### 常用命令

```bash
pnpm install                        # 安装依赖（workspace）
pnpm core:download                  # 下载 mihomo 二进制 + geo 数据 + wintun（需外网）
pnpm dev                            # 开发模式（自动回退驱动的fallback）
pnpm core:e2e                       # FFI 全链路回归（17 项断言，需已构建原生层）
pnpm --filter @teyvat-arkhon/core-bridge exec vitest run   # 单元测试
pnpm --filter @teyvat-arkhon/electron typecheck            # 类型检查
pnpm --filter @teyvat-arkhon/electron build                # electron-vite 构建
pnpm --filter @teyvat-arkhon/electron exec playwright test # Playwright UI 冒烟
pnpm --filter @teyvat-arkhon/electron package:dir          # 本地打包预览（不发布）
```

### 构建原生链路（可选，仅 FFI 模式需要）

> **内核定制基线**：桥接编译的内核源码来自自有 [fork luoqingciya/mihomo-teyvat](https://github.com/luoqingciya/mihomo-teyvat)（`packages/native/bridge/go.mod` 中 `replace` 指向其 `v1.19.30` tag，与上游同一 commit）。在 fork 上改动内核后，打新 tag 并更新 `replace` 版本即可让 CI 产出定制内核。

```bash
# 1) Go 桥接 → libmihomo 共享库（packages/native/bridge 目录内）
CGO_ENABLED=1 CC=<gcc> go build -buildmode=c-shared \
  -ldflags "-s -w -X github.com/metacubex/mihomo/constant.Version=v1.19.30" \
  -o libmihomo.dll .          # .dll / .dylib / .so 按平台

# 2) C++ N-API 绑定 → mihomo_binding.node（packages/native 目录内）
node scripts/patch-cmake-js.mjs   # 打 MinGW 链接兼容补丁（幂等）
# 再以 cmake-js 编译（MinGW 生成器），产物与 libmihomo 一并放入 apps/electron/resources/core/
```

### 验证矩阵

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | 配置解析/订阅导入/TUN 开关/档案管理（9 项） |
| 集成 | `core:e2e` | FFI 直连全链路：导入→启停→路由→流量累计→热重载（17 项） |
| UI | Playwright (_electron) | 启动渲染、导航、设置页可达 |
| CI | GitHub Actions | ubuntu 测试矩阵 + windows UI 冒烟 + tag 打包发布 |

---

## 🔌 订阅格式支持

| 格式 | 支持 | 说明 |
| --- | --- | --- |
| Clash / mihomo 完整 YAML | ✅ | 节点类型覆盖 ss/vmess/trojan/vless/hysteria2/tuic/ssr/http/socks5/wireguard 等，能力随内核 |
| Base64 包装的 YAML | ✅ | 自动解码（含 base64url 变体） |
| HTTP(S) 订阅链接 | ✅ | 携带客户端 UA，兼容多数机场 Clash 端点 |
| v2rayN 类 URI 列表 | ⚠️ | 暂不支持，可先经订阅转换服务转成 Clash 配置 |
| Surge / Shadowrocket / sing-box / SSD | ⚠️ | 暂不支持，请使用/转换 Clash 格式 |

---

## ❓ 常见问题 FAQ

**Q：为什么我导入的订阅提示"无法作为内核配置"？**
A：多半是纯 v2rayN URI 列表或非 Clash 格式。请提供 Clash YAML；v2rayN 用户可先用订阅转换服务（如 subconverter 类）转换后再导入。

**Q：状态栏显示"进程模式"，如何启用 FFI 直连？**
A：FFI 需要完整的原生链路（`libmihomo.*` + `mihomo_binding.node`）。开发机按"构建原生链路"一节编译后放入 `resources/core`；也可直接用 `pnpm core:download` + CI 产物。

**Q：TUN 开关打开后没生效？**
A：TUN 建卡需要管理员权限；Windows 还需 `wintun.dll`（`pnpm core:download` 会尽力获取，网络受限请手动放置）。写明相关后重启内核。

**Q：便携模式与系统目录模式有什么区别？**
A：便携模式把订阅档案/工作配置/geo 等数据从系统用户目录移到运行目录旁的 `data/`，随 U 盘可迁移、绿色免写入系统；系统代理和 Windows 服务仍属系统级，不随便携。切换后需重启应用。

**Q：zip 免安装版和安装版有什么区别？**
A：zip 版解压即可运行、无需写入系统，适合绿色分发与 U 盘携带；默认数据仍在系统用户目录，配合 `portable.txt` / `TEVVAT_ARKHON_PORTABLE=1` 即完全便携。安装版提供开始菜单快捷方式、卸载程序和更平滑的自动更新安装。

**Q：如何关闭自动更新？**
A：启动时设置环境变量 `TEVVAT_ARKHON_DISABLE_UPDATE=1` 即可跳过检查。

**Q：订阅里的节点和分组在哪里切换？**
A：「代理」页顶部的策略组 chips 切换分组，表格中每行可"测速"和"切换"选中节点，或使用"批量测速"。

---

## ⚠️ 已知限制

- **TUN 实机启用**需管理员权限；Windows 依赖 `wintun.dll`。
- **系统服务托管**当前仅 Windows，且服务运行于**进程驱动**模式（不内嵌 FFI）。
- 内嵌内核的 geo 数据路径遵循 mihomo `constant.Path`：便携模式下通过 `XDG_CONFIG_HOME` 指到本地（在默认 `~/.config/mihomo` 已存在时仍优先默认目录，属 mihomo 自身行为）。
- Windows 下 cgo/原生构建需 MinGW-w64（MSVC C++ 工具集不参与编译）。

---

## 📦 打包与发布

- **CI 测试**：每次 push / PR 自动运行单测、类型检查、应用构建（ubuntu）与 Playwright UI 冒烟（windows）。
- **一键发布**：推送 `v*` 标签（例：`git tag v0.2.0 && git push origin v0.2.0`）触发 [release.yml](.github/workflows/release.yml)：
  win/linux 矩阵自动完成 安装 MinGW → Go 编译 `libmihomo`（自 fork）→ cmake-js 编译 `.node` → `core:download`（内核/geo/wintun，固定 v1.19.30）→ electron-builder 打包（**Windows NSIS 安装版 + 免安装 zip / Linux AppImage+deb**）→ 上传 GitHub Releases。
- **自动更新**：应用内置 electron-updater 读取 Releases 最新版本；zip 免安装版直接替换解压目录文件升级。

---

## 📄 许可证与合规

本项目采用 **GPL-3.0** 协议：见 [LICENSE](./LICENSE) 与 [完整文本](https://www.gnu.org/licenses/gpl-3.0.txt)。

- 合规保证：仓库源码即其完整来源；`LICENSE` 随安装包分发；应用「关于」页提供许可证链接；CI 打包流水线含合规检查步骤。
- **内嵌内核上游**：[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)（GPL-3.0），源码与协议见上游仓库。