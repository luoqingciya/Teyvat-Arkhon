# Changelog

本项目的所有重要变更均记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **运行模式切换**：总览页新增 规则/全局/直连 三态切换（PATCH /configs，运行态立即生效）
- **测速设置**：设置页可自定义测速 URL 与超时（localStorage 持久化），节点/批量测速按配置执行
- **内核日志**：捕获 mihomo stdout/stderr 并环形缓冲，实时推送到新增"日志"页（支持复制/清空）
- **连接筛选**：连接页新增搜索框，按 目标/类型/网络/进程/规则 过滤
- 待定：fork 内核定制特性（Teyvat Arkhon 私有内核扩展）

### Changed
- **发布可靠性**：release 流水线新增「内核全链路 E2E 闸门」与「打包产物启动冒烟」
- **完整性校验**：`download-core.mjs` 新增内核/geo 的 SHA256 校验清单 `deps.sha256.json`
- E2E 新增运行模式切换回归用例，合计 21 项断言全绿

### Fixed
- TUN 模式在缺少 `wintun.dll` 时静默不可用：设置页新增明确告警与修复指引

## [0.9.4-rc] - 2026-09-05

### Removed
- **移除 FFI 直连架构**：删除 ffi-driver 与原生绑定加载路径，内核统一使用**进程驱动**（sidecar + REST），稳定优先；发布产物不再包含 libmihomo/.node 等原生模块

### Changed
- 内核链路：唯一驱动为进程驱动，状态栏/关于页显示"进程模式"；CI 发布流水线移除 Go/cgo/cmake 原生构建步骤，包体积更小
- 开发脚本：移除 `ffi:smoke`；E2E 改为进程驱动全链路回归

## [0.9.3-rc] - 2026-09-05

### Fixed
- **修复 Windows 打包版点击"启用内核"闪退**：MinGW 工具链编译的 N-API 绑定在 Electron 运行时加载即崩溃（独立 Node 正常），推送 tag 的产物遂闪退；改为 Windows 打包版默认使用**进程驱动**（功能等价），Linux/macOS 仍走 FFI 直连，设 `TEVVAT_ARKHON_FORCE_FFI=1` 可强制启用 FFI
- 状态栏驱动模式未启动时显示为"进程模式"的误导：现在按真实配置驱动展示

### Changed
- Electron 31 → **40**（内置 Node 24），原生绑定按 Electron 40 headers 编译

## [0.9.2-rc] - 2026-09-05

### Added
- **订阅导入支持更多第三方格式**（自动转换为 Clash/mihomo 配置并生成策略组与默认规则）：
  - 单节点 URI：`ss://`（base64/直写/插件）、`vmess://`、`vless://`（tls/reality/ws/grpc/flow）、`trojan://`（ws/h2/grpc）、`hysteria2://`、`hysteria://`
  - sing-box 导出 JSON（`outbounds` 数组：vless/vmess/trojan/ss/hysteria2/tuic）
  - SSD（shadowsocksD）JSON
  - Surge 节点行（ss / trojan / hy2 常用写法）

## [0.9.1-rc] - 2026-09-05

### Changed
- 窗口/任务栏图标统一使用随包图标资源，Windows 绑定 `AppUserModelId`
- 数据默认跟随运行目录：exe 所在目录可写（免安装版）自动启用便携模式，安装版回退系统用户目录

### Fixed
- zip 免安装版启动崩溃：pnpm strict 布局下 electron-builder 漏打包传递依赖，补齐 electron-updater / fs-extra / js-yaml 等运行时依赖闭包

[Unreleased]: https://github.com/luoqingciya/Teyvat-Arkhon/compare/v0.9.4-rc...HEAD
[0.9.4-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.4-rc
[0.9.3-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.3-rc
[0.9.2-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.2-rc
[0.9.1-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.1-rc
[0.9.0-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.0-rc

## [0.9.0-rc] - 2026-09-05

首个可发布的预览版本，完成第一~四阶段全部功能，CI 打包发布流水线全绿。

### Added

**内核与链路**
- FFI 直连模式：N-API 加载 `libmihomo`（cgo `-buildmode=c-shared`），控制面进程内同步调用、零网络开销
- 进程驱动回退：未探测到原生链路时自动切换 spawn mihomo 二进制 + RESTful API，功能等价
- 内核源码切换至自有 fork [luoqingciya/mihomo-teyvat](https://github.com/luoqingciya/mihomo-teyvat)（v1.19.30）作为定制基线

**订阅与代理**
- 订阅管理：URL / 文本导入（自动 Base64 解码）、导入即校验、档案切换 / 刷新 / 删除
- 代理页：策略组切换、节点表格（类型 / 延迟）、单点测速与批量测速（带逐行进度）
- 实时监控：下载 / 上传速率曲线、累计流量、活跃连接列表（1s 轮询）、单条关闭 / 全部断开

**系统能力**
- 系统代理：Windows（注册表）/ macOS（networksetup）/ Linux（gsettings）一键开关
- TUN 模式：配置级开关 + 热重载（Windows 依赖 Wintun）
- Windows 系统服务托管：开机自启"免打开应用常驻"，可随时安装 / 卸载

**编辑与体验**
- 配置编辑器：CodeMirror 6 + YAML 高亮，保存前校验、运行中热重载
- 亮 / 暗主题（暗色提瓦特基调 + 玻璃拟态）与中英双语即时切换，偏好持久化
- 便携数据模式：`portable.txt` 或 `TEVVAT_ARKHON_PORTABLE=1` 开启，数据全部跟随运行目录
- 自动更新：electron-updater + GitHub Releases（可用环境变量跳过）
- 应用图标：AI 绘制（发光菱形棱晶）+ 主进程窗口图标接入

**发布产物**
- Windows NSIS 安装版（`.exe`）与**免安装 zip 版**（解压即用）
- Linux AppImage 与 deb
- GitHub Actions CI（单测 / 类型检查 / 构建 / Windows UI 冒烟）+ Release（win / linux 矩阵自动打包发布）

### Changed
- 根布局修复：侧边栏由顶部横条恢复为左侧竖栏，首页 2×2 卡片严格等高、控件右对齐
- 发行流水线升级至 pnpm 11 + Node ≥ 22.13；内核资产按平台下载（windows=`zip`，linux/darwin=`gz`）
- FFI 数据面（proxies/connections/延迟）统一走内核 external-controller REST API

### Fixed
- 修复 mihomo v1.19+ 资产格式变化（`.zip` → 平台差异化）导致的内核下载 404
- 修复 cmake-js MinGW 链接补丁缺失闭合括号导致的 `toolset.js` 语法错误
- 修复 choco 新版 mingw 部署路径（`ProgramData\mingw64`）与硬编码不一致导致 cgo 找不到 gcc
- 修复 GitHub API 在 CI runner 出口 IP 下的 403 限流（请求携带 `GH_TOKEN`）
- 修复 release 工作流缺少 `contents: write` 权限导致发布 403
- 移除 electron-builder 非法配置字段 `includeLicenseFiles`（根 LICENSE 自动分发）

[Unreleased]: https://github.com/luoqingciya/Teyvat-Arkhon/compare/v0.9.0-rc...HEAD
[0.9.0-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.0-rc