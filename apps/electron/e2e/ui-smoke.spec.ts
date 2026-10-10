import { test, expect, _electron as electron, type ConsoleMessage } from '@playwright/test'
import { join } from 'node:path'

/**
 * UI 冒烟测试：启动 Electron 应用（进程驱动），
 * 验证主界面渲染、导航与设置页可达。
 * 运行前需先构建：pnpm --filter @teyvat-arkhon/electron build
 */
test('应用可启动并渲染主界面', async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: join(__dirname, '..'),
    env: { ...process.env, TEVVAT_ARKHON_DISABLE_UPDATE: '1' }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // 品牌与导航
    await expect(window.locator('.brand-name')).toHaveText('Teyvat Arkhon')
    await expect(window.locator('.nav-item')).toHaveCount(9)

    // 默认进入总览页：内核状态卡片可见
    await expect(window.locator('.hero-text h1')).toBeVisible()

    // 导航到订阅页：导入卡片与空态列表可见
    await window.locator('.nav-item').nth(2).click()
    await expect(window.locator('h3', { hasText: '导入订阅' })).toBeVisible()
    await expect(window.locator('.empty')).toBeVisible()

    // 导航到分流规则页：页面头与 3 个 Tab 可见（规则集与模板已合并为一个页签）
    await window.locator('.nav-item').nth(3).click()
    await expect(window.locator('h3', { hasText: '分流规则' })).toBeVisible()
    await expect(window.locator('.tab')).toHaveCount(3)

    // 导航到 DNS 分流页：页面头与 3 个 Tab 可见
    await window.locator('.nav-item').nth(4).click()
    await expect(window.locator('h3', { hasText: 'DNS 分流' })).toBeVisible()
    await expect(window.locator('.tab')).toHaveCount(3)

    // 导航到连接页：挂载即订阅连接明细通道（无内核时显示停止空态）
    await window.locator('.nav-item').nth(5).click()
    await expect(window.locator('h3', { hasText: '活跃连接' })).toBeVisible()

    // 导航到设置页（第 7 项，最后一个是日志页）
    await window.locator('.nav-item').nth(7).click()
    await expect(window.locator('h3', { hasText: '外观与语言' })).toBeVisible()
    // 设置页含自启/自动更新/网络自检等卡片
    await expect(window.locator('h3', { hasText: '开机自启' })).toBeVisible()
    await expect(window.locator('h3', { hasText: '订阅自动更新' })).toBeVisible()

    // 语言切换：界面文案随之变化，并同步给主进程（托盘/原生对话框/自检结果跟随）
    const langSelect = window.locator('select:has(option[value="en-US"])')
    await langSelect.selectOption('en-US')
    await expect(window.locator('h3', { hasText: 'Appearance & Language' })).toBeVisible()

    // 主进程语言通道两端是字符串字面量（preload ↔ ipc），类型检查覆盖不到，
    // 这里做一次真实往返，断言主进程回传实际采用的语言。
    const applied = await window.evaluate((lang) => {
      const api = (globalThis as unknown as { arkhon: { setLanguage(v: string): Promise<string> } })
        .arkhon
      return api.setLanguage(lang)
    }, 'en-US')
    expect(applied).toBe('en-US')

    // 再验一条独立通道：证明 preload 桥整体可用（渲染进程已启用 sandbox，
    // 若 preload 未加载成功，window.arkhon 会缺失并在此抛错）
    const appVersion = await window.evaluate(() =>
      (globalThis as unknown as { arkhon: { getAppVersion(): Promise<string> } }).arkhon.getAppVersion()
    )
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+/)

    // 还原中文：语言偏好会被持久化，避免影响后续运行
    await langSelect.selectOption('zh-CN')
    await expect(window.locator('h3', { hasText: '外观与语言' })).toBeVisible()

    // 状态栏存在
    await expect(window.locator('.statusbar')).toBeVisible()

    // 生产构建注入了 CSP：重载一次并捕获控制台，确认无任何违规。
    // 用重载而非直接监听，是为了确定性地覆盖资源加载阶段（firstWindow() 存在时序竞态）。
    const violations: string[] = []
    const onConsole = (msg: ConsoleMessage): void => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text())
    }
    window.on('console', onConsole)
    await window.reload({ waitUntil: 'load' })
    await expect(window.locator('.brand-name')).toHaveText('Teyvat Arkhon')
    window.off('console', onConsole)
    expect(violations).toEqual([])
  } finally {
    await app.close().catch(() => {})
  }
})