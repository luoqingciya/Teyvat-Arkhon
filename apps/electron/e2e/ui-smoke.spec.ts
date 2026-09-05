import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

/**
 * UI 冒烟测试：启动 Electron 应用（进程驱动回退或 FFI），
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
    await expect(window.locator('.nav-item')).toHaveCount(6)

    // 默认进入总览页：内核状态卡片可见
    await expect(window.locator('.hero-text h1')).toBeVisible()

    // 导航到设置页（第 6 项）
    await window.locator('.nav-item').nth(5).click()
    await expect(window.locator('h3', { hasText: '外观与语言' })).toBeVisible()

    // 状态栏存在
    await expect(window.locator('.statusbar')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})