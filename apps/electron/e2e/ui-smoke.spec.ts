import { test, expect, _electron as electron } from '@playwright/test'
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

    // 导航到分流规则页：页面头与 4 个 Tab 可见（未选档案时显示引导空态）
    await window.locator('.nav-item').nth(3).click()
    await expect(window.locator('h3', { hasText: '分流规则' })).toBeVisible()
    await expect(window.locator('.tab')).toHaveCount(4)

    // 导航到 DNS 分流页：页面头与 3 个 Tab 可见
    await window.locator('.nav-item').nth(4).click()
    await expect(window.locator('h3', { hasText: 'DNS 分流' })).toBeVisible()
    await expect(window.locator('.tab')).toHaveCount(3)

    // 导航到设置页（第 7 项，最后一个是日志页）
    await window.locator('.nav-item').nth(7).click()
    await expect(window.locator('h3', { hasText: '外观与语言' })).toBeVisible()
    // 设置页含自启/自动更新/网络自检等卡片
    await expect(window.locator('h3', { hasText: '开机自启' })).toBeVisible()
    await expect(window.locator('h3', { hasText: '订阅自动更新' })).toBeVisible()

    // 状态栏存在
    await expect(window.locator('.statusbar')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})