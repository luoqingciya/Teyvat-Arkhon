/**
 * 主题：亮/暗两套 CSS 变量（暗色为提瓦特默认），持久化到 localStorage。
 */
export type Theme = 'dark' | 'light'

export const THEME_KEY = 'arkhon-theme'

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* 忽略持久化失败 */
  }
}