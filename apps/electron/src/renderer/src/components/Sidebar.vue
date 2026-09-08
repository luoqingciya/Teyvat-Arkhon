<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { useAppStore, type ViewKey } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

const items: Array<{ key: ViewKey; icon: string }> = [
  { key: 'home', icon: 'M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z' },
  {
    key: 'proxies',
    icon: 'M7 4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9l-4-5H7zm9 7h-4V7l4 4zM8 13h4v5H8v-5z'
  },
  { key: 'profiles', icon: 'M6 3h9l4 4v14H6V3zm8 1.5V8h3.5L14 4.5zM8 12h8v1.5H8V12zm0 3.5h8V17H8v-1.5z' },
  { key: 'connections', icon: 'M6 10.5h12l-1.2-2H7.2L6 10.5zM4.6 7h14.8l1.6 2.6-2.3 8.9h-14L2.9 9.6zM9 13h6v1.5H9z' },
  { key: 'config', icon: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z' },
  {
    key: 'settings',
    icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.4-3.5a7.5 7.5 0 0 0-.08-1.2l2-1.55-2-3.46-2.36.95a7.5 7.5 0 0 0-2.07-1.2L14.5 3.1h-4l-.39 2.44a7.5 7.5 0 0 0-2.07 1.2l-2.36-.95-2 3.46 2 1.55a7.5 7.5 0 0 0-.08 1.2c0 .41.03.81.08 1.2l-2 1.55 2 3.46 2.36-.95c.63.5 1.32.91 2.07 1.2l.39 2.44h4l.39-2.44a7.5 7.5 0 0 0 2.07-1.2l2.36.95 2-3.46-2-1.55c.05-.39.08-.79.08-1.2z'
  },
  {
    key: 'logs',
    icon: 'M6 4h14v2H8v6h10v2H8v6h12v2H6zM4 4h2v16H4z'
  }
]
</script>

<template>
  <aside class="sidebar glass">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
          <defs>
            <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#9db8ff" />
              <stop offset="1" stop-color="#7ae7ff" />
            </linearGradient>
          </defs>
          <path d="M20 2 24 14 36 18 24 22 20 34 16 22 4 18 16 14Z" fill="url(#brand-grad)" />
          <circle cx="34" cy="6" r="1.8" fill="#e8edf6" opacity="0.85" />
          <circle cx="36.5" cy="15" r="1.1" fill="#e8edf6" opacity="0.6" />
          <circle cx="6" cy="32" r="1.3" fill="#e8edf6" opacity="0.5" />
        </svg>
      </div>
      <div>
        <div class="brand-name">Teyvat Arkhon</div>
        <div class="brand-sub">{{ t('home.title') }}</div>
      </div>
    </div>
    <nav class="nav">
      <button
        v-for="it in items"
        :key="it.key"
        class="nav-item"
        :class="{ active: store.activeView === it.key }"
        @click="store.setView(it.key)"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path :d="it.icon" />
        </svg>
        <span>{{ t(`nav.${it.key}`) }}</span>
      </button>
    </nav>
    <div class="foot">
      <span class="version">v{{ store.appVersion || '0.1.0' }}</span>
      <span class="dash">·</span>
      <span>GPL-3.0</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 210px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 14px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 6px;
}
.brand-mark {
  width: 42px;
  height: 42px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: linear-gradient(140deg, rgba(79, 124, 255, 0.22), rgba(56, 189, 248, 0.12));
  box-shadow: inset 0 0 0 1px rgba(122, 166, 255, 0.35), 0 4px 14px rgba(56, 120, 255, 0.18);
}
.brand-mark svg {
  filter: drop-shadow(0 0 6px rgba(122, 199, 255, 0.35));
}
.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.brand-sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text-dim);
  font-size: 15px;
  cursor: pointer;
  transition: background 0.18s, color 0.18s, transform 0.18s;
}
.nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 60%;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #4f7cff, #38bdf8);
  transition: transform 0.18s;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.nav-item.active {
  background: linear-gradient(135deg, rgba(79, 124, 255, 0.22), rgba(56, 189, 248, 0.14));
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(79, 124, 255, 0.35);
}
.nav-item.active::before {
  transform: translateY(-50%) scaleY(1);
  box-shadow: 0 0 8px rgba(79, 124, 255, 0.55);
}
.nav-item:not(.active):hover {
  transform: translateX(2px);
}
.foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-faint);
  padding: 0 8px;
}
.foot .version {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.foot .dash {
  opacity: 0.6;
}
</style>