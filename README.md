<div align="center">

# Teyvat Arkhon（提瓦特方舟）

基于 **Electron + C/C++** 的跨平台网络代理客户端，内嵌 **[Mihomo](https://github.com/MetaCubeX/mihomo)（Clash Meta）** 内核（sidecar 进程驱动，稳定优先），提供高性能、低延迟、支持 TUN 与系统服务托管的专业级代理方案。

[![CI](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/ci.yml/badge.svg)](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-GitHub%20Actions-blue)](https://github.com/luoqingciya/Teyvat-Arkhon/actions/workflows/release.yml)
[![Download](https://img.shields.io/badge/download-Releases-green)](https://github.com/luoqingciya/Teyvat-Arkhon/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-green)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F)](https://www.electronjs.org)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D)](https://vuejs.org)

> 当前预发布版本：**v0.9.9-rc**（Windows 安装版 / 免安装 zip · Linux AppImage / deb）

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

- **进程驱动内核（稳定优先）**：以 sidecar 方式运行 mihomo 二进制（`resources/core/mihomo-<平台>-<架构>`），控制面与数据面统一走内核内建 `external-controller` REST API（启动/停止/热重载/节点/延迟/连接）。独立进程天然隔离、升级与排障简单，跨平台行为一致。

**订阅与代理**

- **订阅管理**：URL 或粘贴文本导入（自动 Base64 解码），同页切换/刷新/删除，导入即校验（YAML 解析 + 最小合法性检查）。
- **订阅自动更新**：启动即刷新全部 URL 订阅，之后每 6 小时定时刷新（设置页可开关）；失败保留旧档，成功自动热重载当前档案。
- **策略组操作**：策略组切换、单节点测速、**批量测速**（限量并发，逐行反馈进度）、按延迟排序。
- **实时监控**：下载/上传瞬时速率曲线、累计流量、活跃连接列表（目标/类型/上下行/规则/进程），连接可**单独关闭或全部断开**。

**系统能力**

- **系统代理**：Windows（注册表）/ macOS（networksetup）/ Linux（gsettings）一键开启/关闭，端口与内核 `mixed-port` 联动。
- **TUN 模式**：透明代理接管全局流量（含不遵守系统代理的软件）；Windows 依赖 Wintun 驱动，配置级开关 + 热重载。
- **Windows 服务托管**：将内核注册为开机自启服务，实现"免打开应用常驻"；无需常驻时随时卸载。
- **UWP 回环豁免（Windows）**：一键豁免/撤销 Microsoft Store、邮件、Xbox 等 UWP 应用的回环限制，使其可经内核代理访问网络。

**诊断与体验**

- **网络自检**：经内核代理链路探测出口 IP/地区与 Netflix / YouTube / OpenAI 可达性，快速定位链路问题。
- **配置编辑器**：CodeMirror 6 YAML 语法高亮；保存前校验、内核运行中自动热重载。
- **主题 & 国际化**：亮/暗双主题（暗色为提瓦特基调，玻璃拟态质感）；简体中文 / English 即时切换，偏好持久化。
- **自动更新**：基于 GitHub Releases 的 electron-updater，后台静默下载、退出时安装（可用环境变量跳过）。
- **系统托盘**：关闭主窗口最小化到托盘，托盘菜单可显示/退出。
- **数据归置**：免安装版数据默认跟随运行目录（`data/`），安装版使用系统用户目录；可切换便携模式。

---

## 🚀 快速上手

1. **获取应用**：从 [Releases](https://github.com/luoqingciya/Teyvat-Arkhon/releases) 下载对应产物 —— **Windows**：NSIS 安装版（`.exe`）或 **免安装 zip 版**（`.zip`，解压即用）；**Linux**：AppImage 或 deb。
2. **导入订阅**：打开应用 →「订阅」页 → 粘贴 Clash 订阅链接、完整 YAML 或任意节点 URI（见订阅格式）→ 导入。
3. **启动内核**：回到「总览」页点击 **启动内核**；在「代理」页选择节点并测速；如需全局接管可开启「系统代理」或「TUN」。

> 提示：TUN 模式需要管理员权限；Windows 下若缺少 `wintun.dll`，请手动放入 `resources/core` 或内核工作目录。
>
> 提示：**zip 免安装版**数据默认就在解压目录的 `data/` 下（随 exe 走的绿色便携，无需额外设置）；安装版数据在系统用户目录。

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
│      └─ ProcessCoreDriver ──► spawn mihomo 二进制 + external-controller│
│           ├─ 控制面: start/stop/reload/version（REST /configs 等）       │
│           └─ 数据面: proxies/connections/delay（内核 RESTful API）        │
└────────────────────────────────────────────────────────────────────────┘
```

- **内核进程**：随应用启动/停止，工作目录为数据目录（存放 `config.yaml` 与 TUN 驱动），崩溃/退出状态可感知。
- **数据面**（proxies/connections/delay/configs）：内核 `external-controller` REST API，端口与密钥取自当前工作配置。
- **状态反馈**：主进程 1s 轮询内核状态与流量，实时推送给界面；子进程异常退出自动回落后端状态。

### 运行时数据布局

| 数据 | 免安装版（zip，数据跟随运行目录） | 安装版 / 开发期（系统用户目录） |
| --- | --- | --- |
| 订阅档案 / 工作配置 `config.yaml` | `运行目录/data` | `%APPDATA%\<app>` |
| geo 数据（geoip/geosite） | `运行目录/data/mihomo` | `~/.config/mihomo` |
| wintun 驱动 | `运行目录/data/config/` | 数据目录 `config/` |
| 系统代理 / 服务注册 | 系统级（注册表 / sc） | 系统级，不随便携 |

> 数据归置策略：**exe 所在目录可写（解压免安装版）时自动启用便携模式**，数据落在 exe 同级的 `data/`，无需任何配置；安装版（如 Program Files 不可写）自动回退系统用户目录。也可用 `portable.txt` 或环境变量 `TEVVAT_ARKHON_PORTABLE=1` 强制开启，设置页「数据与便携」可查询当前目录。

---

## 🖥 功能导览

| 页面 | 功能 |
| --- | --- |
| **总览** | 内核启停（大按钮）、运行状态/内核版本、规则/全局/直连模式切换、系统代理开关、实时流量卡片（速率曲线+连接数+累计）、快速开始 |
| **代理** | 节点/规则双视图：策略组切换（chips）、节点表格（类型/延迟）、单点测速、批量测速（带进度）、按延迟排序、选中高亮；规则视图（类型/目标/目标组/命中，搜索+按命中排序） |
| **订阅** | URL 导入、文本导入（textarea）、档案列表（使用中/刷新/删除/切换） |
| **连接** | 活跃连接表格（1s 刷新）、单条关闭、全部断开、累计流量总览 |
| **配置** | CodeMirror YAML 编辑、保存即校验 + 热重载、校验失败回显错误 |
| **设置** | TUN 开关、主题（亮/暗）、语言（zh/en）、数据目录与便携、系统服务（安装/卸载/状态）、关于（版本/许可证） |
| **状态栏** | 内核状态灯、驱动/内核版本、连接数胶囊、错误提示 |

---

## 🛠 开发指南

### 环境要求

- Node.js ≥ 22.13、pnpm 11（monorepo workspace + strict 布局）
- 打包需要 electron-builder 依赖（CI 已内置）

### 常用命令

```bash
pnpm install                        # 安装依赖（workspace）
pnpm core:download                  # 下载 mihomo 二进制 + geo 数据 + wintun（需外网）
pnpm dev                            # 开发模式
pnpm core:e2e                       # E2E 全链路回归（17 项断言，需已放置内核二进制）
pnpm --filter @teyvat-arkhon/core-bridge exec vitest run   # 单元测试
pnpm --filter @teyvat-arkhon/electron typecheck            # 类型检查
pnpm --filter @teyvat-arkhon/electron build                # electron-vite 构建
pnpm --filter @teyvat-arkhon/electron exec playwright test # Playwright UI 冒烟
pnpm --filter @teyvat-arkhon/electron package:dir          # 本地打包预览（不发布）
```

### 内核来源

下载脚本 [download-core.mjs](scripts/download-core.mjs) 从 GitHub Releases 拉取与内核版本匹配的 mihomo 二进制与 geo 数据到 `apps/electron/resources/core`。如需自定义内核，可手动替换 `resources/core/mihomo-<平台>-<架构>`（fork 定制工作副本见仓库相邻目录 `mihomo-teyvat/`）。

### 验证矩阵

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | 配置解析/订阅导入（含 URI 转换与全参数映射）/TUN 开关/档案管理/模式持久化（24 项） |
| 集成 | `core:e2e` | 进程驱动全链路：导入→启停→路由→流量累计→热重载→模式切换→规则数据面（24 项） |
| UI | Playwright (_electron) | 启动渲染、导航、设置页可达 |
| CI | GitHub Actions | ubuntu 测试矩阵 + windows UI 冒烟 + tag 打包发布 |

---

## 🔌 订阅格式支持

| 格式 | 支持 | 说明 |
| --- | --- | --- |
| Clash / mihomo 完整 YAML | ✅ | 节点类型覆盖 ss/vmess/trojan/vless/hysteria2/tuic/ssr/http/socks5/wireguard 等，能力随内核 |
| Base64 包装的 YAML | ✅ | 自动解码（含 base64url 变体） |
| HTTP(S) 订阅链接 | ✅ | 携带客户端 UA，兼容多数机场 Clash 端点 |
| **单节点 URI（ss/vmess/vless/trojan/hysteria2）** | ✅ | 粘贴即导，自动转 Clash 节点并生成策略组；支持 base64 与参数形式：ws/grpc/**reality（含 flow）**/tls/obfs、**hysteria2 pinSHA256 证书指纹**、grpc `serviceName` 等 |
| **sing-box 导出 JSON** | ✅ | 识别 `outbounds` 数组，转换 vless/vmess/trojan/ss/hysteria2/tuic（含 vless flow、tuic 拥塞控制、utls 指纹） |
| **SSD（shadowsocksD）** | ✅ | 标准 SSD JSON（servers 数组）自动转 ss 节点 |
| **Surge 节点行** | ✅ | `Name = ss/trojan/hy2, …` 基础格式 |
| Shadowrocket | ✅ | 其导出为 v2rayN URI，走 URI 导入 |
| 其他（sing-box 复杂 inbound 等） | ⚠️ | 超出上行字段的复杂编排暂不转换，建议使用 Clash 格式 |

---

## ❓ 常见问题 FAQ

**Q：为什么我导入的订阅提示"无法作为内核配置"？**
A：多半是未识别格式或内容损坏。请提供 Clash YAML；v2rayN 用户可用订阅转换服务转换后再导入。

**Q：内核启动了，但状态一直显示"已停止"？**
A：内核子进程异常退出时应用会回落后端状态。可打开「配置」页检查 `config.yaml`，确认 `external-controller` 端口未被占用、geo 数据存在。

**Q：TUN 开关打开后没生效？**
A：TUN 建卡需要管理员权限；Windows 还需 `wintun.dll`（`pnpm core:download` 会尽力获取，网络受限请手动放置）。配置生效后重启内核。

**Q：便携模式与系统目录模式有什么区别？**
A：便携模式把订阅档案/工作配置/geo 等数据从系统用户目录移到运行目录旁的 `data/`，随 U 盘可迁移、绿色免写入系统；系统代理和 Windows 服务仍属系统级，不随便携。切换后需重启应用。

**Q：zip 免安装版和安装版有什么区别？**
A：zip 版解压即可运行、无需写入系统，适合绿色分发与 U 盘携带，且数据默认跟随解压目录；安装版提供开始菜单快捷方式、卸载程序和更平滑的自动更新安装。

**Q：如何关闭自动更新？**
A：启动时设置环境变量 `TEVVAT_ARKHON_DISABLE_UPDATE=1` 即可跳过检查。

**Q：订阅如何自动刷新？**
A：设置页「订阅自动更新」开关（默认关闭）。开启后启动时及每 6 小时自动刷新全部 URL 订阅：失败保留旧配置，成功自动热重载当前档案；也可随时点「立即刷新」。

**Q：订阅里的节点和分组在哪里切换？**
A：「代理」页顶部的策略组 chips 切换分组，表格中每行可"测速"和"切换"选中节点，或使用"批量测速"。

---

## ⚠️ 已知限制

- **TUN 实机启用**需管理员权限；Windows 依赖 `wintun.dll`。
- **系统服务托管**当前仅 Windows，服务运行于进程驱动模式（与桌面端一致）。
- 内核 geo 数据路径遵循 mihomo `constant.Path`：便携模式下通过 `XDG_CONFIG_HOME` 指到本地（在默认 `~/.config/mihomo` 已存在时仍优先默认目录，属 mihomo 自身行为）。

---

## 📦 打包与发布

- **CI 测试**：每次 push / PR 自动运行单测、类型检查、应用构建（ubuntu）与 Playwright UI 冒烟（windows）。
- **一键发布**：推送 `v*` 标签（例：`git tag v0.2.0 && git push origin v0.2.0`）触发 [release.yml](.github/workflows/release.yml)：
  win/linux 矩阵自动完成 安装依赖 → `core:download`（内核/geo/wintun，固定 v1.19.30）→ electron-builder 打包（**Windows NSIS 安装版 + 免安装 zip / Linux AppImage+deb**）→ 上传 GitHub Releases。
- **自动更新**：应用内置 electron-updater 读取 Releases 最新版本；zip 免安装版直接替换解压目录文件升级。

---

## 📄 许可证与合规

本项目采用 **GPL-3.0** 协议：见 [LICENSE](./LICENSE) 与 [完整文本](https://www.gnu.org/licenses/gpl-3.0.txt)。

- 合规保证：仓库源码即其完整来源；`LICENSE` 随安装包分发；应用「关于」页提供许可证链接；CI 打包流水线含合规检查步骤。
- **内嵌内核上游**：[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)（GPL-3.0），源码与协议见上游仓库。