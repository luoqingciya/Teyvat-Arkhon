/**
 * 国际化：i18next（zh-CN / en-US）
 * 主题与语言偏好均持久化在 localStorage。
 */

import i18next from 'i18next'
// i18next-vue 的 useTranslation 在组件内创建 reactive 实例，避免与 store 联动时的闭包问题
import { useTranslation } from 'i18next-vue'

export type Lang = 'zh-CN' | 'en-US'

const resources = {
  'zh-CN': {
    translation: {
      nav: { home: '总览', proxies: '代理', profiles: '订阅', connections: '连接', config: '配置', settings: '设置' },
      status: {
        stopped: '已停止',
        starting: '启动中',
        running: '运行中',
        stopping: '停止中',
        error: '异常',
        driver: '驱动',
        driverProcess: '进程模式',
        sysProxyOn: '系统代理已开启'
      },
      home: {
        title: '提瓦特方舟',
        subtitle: '基于 Mihomo 内核的高速网络代理客户端 · 深渊亦可畅行',
        start: '启动内核',
        stop: '停止内核',
        busy: '处理中…',
        coreState: '内核状态',
        state: '状态',
        driver: '驱动模式',
        version: '内核版本',
        sysProxy: '系统代理',
        sysProxyHint: '开启后本机 HTTP/SOCKS5 流量将走内核本地混合端口',
        enableSysProxy: '启用系统代理',
        traffic: '实时流量',
        download: '下载',
        upload: '上传',
        connections: '连接数',
        total: '累计 ↓ {{down}} · 累计 ↑ {{up}}',
        coreStopped: '（内核未运行）',
        quickStart: '快速开始',
        step1: '前往<b>订阅</b>页导入你的 Clash 订阅链接或粘贴配置',
        step2: '回到本页点击<b>启动内核</b>',
        step3: '在<b>代理</b>页选择节点并测速'
      },
      proxies: {
        groups: '策略组',
        refresh: '刷新',
        batchTest: '批量测速',
        testing: '批量测速中 {{cur}}/{{total}}',
        node: '节点',
        type: '类型',
        delay: '延迟',
        action: '操作',
        test: '测速',
        switch: '切换',
        selected: '已选中',
        timeout: '超时',
        empty: '内核未运行，启动后在此查看节点',
        emptyGroup: '该策略组暂无节点'
      },
      profiles: {
        import: '导入订阅',
        urlPlaceholder: '粘贴订阅链接 (https://…)',
        importBtn: '导入',
        textToggle: '从文本导入（分享的 YAML / base64 内容）',
        namePlaceholder: '订阅名称（可选）',
        contentPlaceholder: '粘贴完整配置内容…',
        importText: '导入文本',
        processing: '处理中…',
        empty: '还没有任何订阅，请先导入',
        inUse: '使用中',
        use: '切换使用',
        used: '已使用',
        refresh: '刷新',
        remove: '删除',
        nodes: '节点'
      },
      connections: {
        title: '活跃连接',
        empty: '当前没有活跃连接',
        host: '目标',
        type: '类型',
        network: '网络',
        dl: '下行',
        ul: '上行',
        rule: '规则',
        process: '进程',
        started: '开始于',
        action: '操作',
        close: '关闭',
        closeAll: '关闭全部',
        totalHint: '活跃 {{count}} 条 · 累计 ↓{{down}} / ↑{{up}}'
      },
      config: {
        title: '规则与配置编辑器',
        hint: '编辑当前生效的工作配置（config.yaml）。保存前会做 YAML 校验，内核运行中自动热重载。',
        save: '保存并重载',
        saved: '已保存并热重载',
        empty: '还没有工作配置，请先在订阅页导入并启用一个订阅',
        errorSaving: '保存失败'
      },
      settings: {
        title: '设置',
        tun: 'TUN 模式',
        tunHint: '透明代理接管全局流量（含不遵守系统代理的软件）。启用需管理员权限；内核重启后生效。',
        enableTun: '启用 TUN 模式',
        tunEffective: '已写入配置，启动内核后生效',
        tunRunning: '全局模式生效中',
        service: '系统服务托管',
        serviceHint: '将 mihomo 内核注册为 Windows 服务，实现开机自启、免打开应用常驻（服务运行在进程驱动模式）。',
        svcStatus: '服务状态',
        installSvc: '安装并启动',
        uninstallSvc: '卸载',
        svcNote: '安装/卸载会弹出 UAC 授权确认。',
        notInstalled: '未安装',
        installed: '已安装（未运行）',
        running: '运行中',
        stopped: '已停止',
        unknown: '未知',
        appearance: '外观与语言',
        theme: '主题',
        dark: '暗色（提瓦特）',
        light: '亮色',
        language: '语言',
        about: '关于',
        version: '版本',
        license: '协议',
        licenseText: '许可证文本'
      },
      common: { apply: '应用', cancel: '取消', save: '保存' }
    }
  },
  'en-US': {
    translation: {
      nav: { home: 'Home', proxies: 'Proxies', profiles: 'Subscriptions', connections: 'Connections', config: 'Config', settings: 'Settings' },
      status: {
        stopped: 'Stopped',
        starting: 'Starting',
        running: 'Running',
        stopping: 'Stopping',
        error: 'Error',
        driver: 'Driver',
        driverProcess: 'Process mode',
        sysProxyOn: 'System proxy ON'
      },
      home: {
        title: 'Teyvat Arkhon',
        subtitle: 'High-speed proxy client powered by Mihomo core',
        start: 'Start Core',
        stop: 'Stop Core',
        busy: 'Working…',
        coreState: 'Core Status',
        state: 'State',
        driver: 'Driver',
        version: 'Core Version',
        sysProxy: 'System Proxy',
        sysProxyHint: 'Route local HTTP/SOCKS5 traffic through the mixed port',
        enableSysProxy: 'Enable system proxy',
        traffic: 'Live Traffic',
        download: 'Download',
        upload: 'Upload',
        connections: 'Connections',
        total: 'Total ↓{{down}} · ↑{{up}}',
        coreStopped: '(core stopped)',
        quickStart: 'Quick Start',
        step1: 'Import a Clash subscription in the <b>Subscriptions</b> page',
        step2: 'Click <b>Start Core</b>',
        step3: 'Pick a node and test latency in the <b>Proxies</b> page'
      },
      proxies: {
        groups: 'Groups',
        refresh: 'Refresh',
        batchTest: 'Test All',
        testing: 'Testing {{cur}}/{{total}}',
        node: 'Node',
        type: 'Type',
        delay: 'Latency',
        action: 'Action',
        test: 'Test',
        switch: 'Use',
        selected: 'Selected',
        timeout: 'timeout',
        empty: 'Core is not running',
        emptyGroup: 'No nodes in this group'
      },
      profiles: {
        import: 'Import Subscription',
        urlPlaceholder: 'Paste subscription URL (https://…)',
        importBtn: 'Import',
        textToggle: 'Import from text (YAML / base64 content)',
        namePlaceholder: 'Name (optional)',
        contentPlaceholder: 'Paste full config content…',
        importText: 'Import Text',
        processing: 'Working…',
        empty: 'No subscriptions yet',
        inUse: 'In use',
        use: 'Use',
        used: 'In use',
        refresh: 'Refresh',
        remove: 'Remove',
        nodes: 'nodes'
      },
      connections: {
        title: 'Active Connections',
        empty: 'No active connections',
        host: 'Host',
        type: 'Type',
        network: 'Network',
        dl: 'Download',
        ul: 'Upload',
        rule: 'Rule',
        process: 'Process',
        started: 'Started',
        action: 'Action',
        close: 'Close',
        closeAll: 'Close All',
        totalHint: '{{count}} active · total ↓{{down}} / ↑{{up}}'
      },
      config: {
        title: 'Rules & Config Editor',
        hint: 'Edit the active working config (config.yaml). YAML is validated before saving; hot-reloads if core is running.',
        save: 'Save & Reload',
        saved: 'Saved and reloaded',
        empty: 'No working config yet — import a subscription first',
        errorSaving: 'Save failed'
      },
      settings: {
        title: 'Settings',
        tun: 'TUN Mode',
        tunHint: 'Transparent proxy for all traffic (including apps ignoring system proxy). Requires admin; takes effect after core restart.',
        enableTun: 'Enable TUN',
        tunEffective: 'Written to config, effective after core start',
        tunRunning: 'Global mode active',
        data: 'Data & Portable',
        dataHint: 'Subscriptions, working config and geo data live in the data directory. Portable mode keeps data beside the app (green-edition); takes effect after restart.',
        dataDir: 'Data directory',
        portableOn: 'Enable portable',
        portableOff: 'Disable portable',
        service: 'System Service',
        serviceHint: 'Register mihomo as a Windows service for auto-start & always-on (runs in process-driver mode).',
        svcStatus: 'Service state',
        installSvc: 'Install & Start',
        uninstallSvc: 'Uninstall',
        svcNote: 'UAC prompt will appear.',
        notInstalled: 'Not installed',
        installed: 'Installed (stopped)',
        running: 'Running',
        stopped: 'Stopped',
        unknown: 'Unknown',
        appearance: 'Appearance & Language',
        theme: 'Theme',
        dark: 'Dark (Teyvat)',
        light: 'Light',
        language: 'Language',
        about: 'About',
        version: 'Version',
        license: 'License',
        licenseText: 'License text'
      },
      common: { apply: 'Apply', cancel: 'Cancel', save: 'Save' }
    }
  }
}

function createI18n(): void {
  if (i18next.isInitialized) return
  void i18next.init({
    lng: typeof localStorage !== 'undefined' ? localStorage.getItem('arkhon-lang') ?? 'zh-CN' : 'zh-CN',
    fallbackLng: 'zh-CN',
    resources,
    interpolation: { escapeValue: false }
  })
}

/** 切换语言并持久化 */
function setLanguage(lang: Lang): void {
  void i18next.changeLanguage(lang)
  localStorage.setItem('arkhon-lang', lang)
}

export { createI18n, setLanguage, useTranslation }