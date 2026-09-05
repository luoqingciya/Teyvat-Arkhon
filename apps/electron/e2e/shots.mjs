import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'

async function shot(name, page, out) {
  await page.screenshot({ path: out })
  console.log('saved', name, '->', out)
}

const app = await electron.launch({
  args: ['.'],
  cwd: join(process.cwd()),
  env: { ...process.env, TEVVAT_ARKHON_DISABLE_UPDATE: '1' }
})
try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await new Promise((r) => setTimeout(r, 900))
  await shot('home', window, 'shots-home.png')

  await window.locator('.nav-item').nth(1).click()
  await new Promise((r) => setTimeout(r, 400))
  await shot('proxies', window, 'shots-proxies.png')

  await window.locator('.nav-item').nth(2).click()
  await new Promise((r) => setTimeout(r, 400))
  await shot('profiles', window, 'shots-profiles.png')

  await window.locator('.nav-item').nth(3).click()
  await new Promise((r) => setTimeout(r, 400))
  await shot('connections', window, 'shots-connections.png')

  await window.locator('.nav-item').nth(4).click()
  await new Promise((r) => setTimeout(r, 400))
  await shot('config', window, 'shots-config.png')

  await window.locator('.nav-item').nth(5).click()
  await new Promise((r) => setTimeout(r, 400))
  await shot('settings', window, 'shots-settings.png')
} finally {
  await app.close().catch(() => {})
}