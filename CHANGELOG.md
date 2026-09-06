# Changelog

本项目的所有重要变更均记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

[Unreleased]: https://github.com/luoqingciya/Teyvat-Arkhon/compare/v0.9.10-rc...HEAD

## [0.9.10-rc] - 2026-09-06

### Changed
- **内嵌内核切换为专属定制内核 `arkhon-core`**（基于 MetaCubeX/mihomo 的 fork）：内核仓库、二进制/资产命名统一改为 `arkhon-*`（`luoqingciya/arkhon-core`），应用下载源、完整性校验哈希随之更新（v0.9.10-arkhon）
- **运行模式持久化**：所选模式（规则/全局/直连）写入档案配置，重启后保持
- **订阅自动更新**：启动时与每 6 小时周期自动刷新订阅，失败自动回退；设置页提供开关
- **网络自检**：设置页新增一键自检（出口 IP 与流媒体服务可达性）
- **UWP 回环豁免**：Windows 下可将 UWP 应用加入回环豁免（CheckNetIsolation）
- 同时测速改为并发执行，按延迟排序；收藏节点可置顶

### Added
- **托盘快速切换档案**：托盘右键菜单直接切换档案并热重载
- **订阅排除关键词**：设置页配置关键词，导入/刷新时自动剔除节点并清理组引用
- **多格式订阅导入**：支持 hysteria2/ss/vmess/vless/trojan/hysteria URI 与 sing-box 导出、SSD、Surge 节点行
- **日志页重构**：三栏展示（时间戳/级别/消息），支持级别过滤、关键词搜索、跟随最新

### Fixed
- **hysteria2 端口跳跃（mport）**：映射为 mihomo `ports` + `hop-interval`（此前仅连单端口导致完全连不上）
- **订阅刷新兼容 URI 列表**：URL 订阅为 v2rayN URI 格式时刷新/自动更新不再校验失败
- hysteria2 `pinSHA256` 归一为裸 hex，兼容 mihomo/hysteria fingerprint 解析差异

验证：typecheck / 26 项单测 / lint（含新增 DOM 全局）/ electron-vite 构建 / 24 项内核 E2E / UI 冒烟全绿。

## [0.9.9-rc] - 2026-09-06

### Fixed
- **hysteria2 端口跳跃（mport）**：v2rayN 链接的 `mport=45000-50000` 现映射为 mihomo `ports` + `hop-interval`；服务端启用跳跃区间时此前仅连单端口导致完全连不上（v2rayN 正常、本应用不可用的常见根因）
- **订阅刷新不走 URI 转换**：URL 订阅为 v2rayN URI 列表格式时，`refreshProfile`/自动更新此前按 YAML 校验必失败；现与首次导入一致（并修复 `res.text()` 二次读取异常）
- hysteria2 `pinSHA256` 值归一为裸 hex（去除冒号分隔），兼容 mihomo/hysteria 对 `fingerprint` 按 hex 解析的实现差异

验证：typecheck / 26 项单测（新增 mport 真实结构、刷新 URI 订阅用例）/ lint / electron-vite 构建 / 24 项内核 E2E 全绿。

## [0.9.8-rc] - 2026-09-06

### Fixed（订阅转换参数完善，修复多个"v2rayN 能用、本应用连不上"场景）
- **hysteria2 丢失 `pinSHA256` 证书指纹**：URI 的 pinSHA256 现映射为 mihomo `fingerprint` 字段；自签/私签证书服务端此前默认走系统 CA 校验导致 TLS 握手失败
- **vless reality 丢失 `flow`**：`flow=xtls-rprx-vision` 不再依赖 encryption 参数，reality 节点可正常连接
- **vless/trojan grpc 丢失 `serviceName`**：grpc-service-name 优先取 `serviceName`/`service_name` 参数（此前误用 host 导致 grpc 节点连不上）
- sing-box 导出补齐 vless `flow` 与 tuic `congestion_control` 映射；hysteria2 `up`/`down` 纯数字自动补带宽单位

验证：typecheck / 24 项单测（新增 pinSHA256、reality+flow+grpc、trojan grpc、sing-box flow/tuic 用例）/ lint / electron-vite 构建全绿。

## [0.9.7-rc] - 2026-09-06

### Added
- **路由规则查看**：代理页新增「节点 / 规则」双视图，实时展示当前生效规则（类型 / 匹配目标 / 目标组 / 命中次数），支持关键词搜索与按命中排序（规则类型为 mihomo 规范化名，如 DomainSuffix / Match）

### Changed
- **Release 正文自动化**：release 流水线从 CHANGELOG.md 抽取当前 tag 对应版本段落，自动写入 GitHub Release 说明（免手工编辑正文；缺段落时静默跳过，更新失败不阻塞）
- v0.9.6-rc 的 GitHub Release 正文已补录（此前为空）

验证：typecheck / 20 项单测 / electron-vite 构建 / 24 项内核 E2E（含 /rules 数据面回归）/ Playwright UI 冒烟全绿。

## [0.9.6-rc] - 2026-09-06

### Added
- **订阅自动更新**：启动即刷新全部 URL 订阅，之后每 6 小时定时刷新（设置页可开关、手动"立即刷新"）；失败保留旧档，成功自动热重载当前档案
- **网络自检**：经内核代理链路探测出口 IP/地区与 Netflix / YouTube / OpenAI 可达性，设置页分项展示结果与耗时
- **UWP 回环豁免（Windows）**：一键豁免 / 撤销 Microsoft Store、邮件、Xbox 等 UWP 应用的回环限制（CheckNetIsolation），非 Windows 自动隐藏入口
- **测速并发化**：批量测速改为限量并发（8 并发游标队列，逐行反馈进度）；代理页新增"按延迟排序"（超时/未测节点置底）
- 日志页**搜索框与级别过滤**（信息 / 警告 / 错误 / 调试）与"跟随最新"开关

### Changed
- **运行模式持久化**：切换 规则 / 全局 / 直连 同步写回工作配置 `mode` 字段，内核重启后保持用户选择
- **日志页可读性重构**：自动解析 mihomo 日志为 时间戳 / 级别徽标 / 消息 三栏（兼容新版与 logrus 旧格式），按级别着色（debug/info/warning/error/panic），长行不再硬折断 URL
- 订阅 / 模式切换等 IPC 全面接入 preload 类型与主进程接线；订阅自动更新开关持久化于 `userData/settings.json`

### Fixed
- eslint 配置缺失渲染端 DOM 全局（`setTimeout` / `Event` / `HTML*Element`）导致的 lint 失败
- core-bridge `uri-profiles` 中 `modeSeen` 死代码 lint 报错（行为不变，输出等价）

验证：typecheck / 20 项单测 / electron-vite 构建 / 21 项内核 E2E / Playwright UI 冒烟全绿。

## [0.9.5-rc] - 2026-09-05

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

[0.9.9-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.9-rc
[0.9.8-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.8-rc
[0.9.7-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.7-rc
[0.9.6-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.6-rc
[0.9.5-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.5-rc
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

[0.9.0-rc]: https://github.com/luoqingciya/Teyvat-Arkhon/releases/tag/v0.9.0-rc