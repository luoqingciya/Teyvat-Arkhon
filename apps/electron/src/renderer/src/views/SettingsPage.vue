<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'
import { setLanguage, type Lang } from '../i18n'

const store = useAppStore()
const { t } = useTranslation()
const currentLang = ref<Lang>((localStorage.getItem('arkhon-lang') as Lang) ?? 'zh-CN')

const serviceStateText = computed<Record<string, string>>(() => ({
  'not-installed': t('settings.notInstalled'),
  installed: t('settings.installed'),
  running: t('settings.running'),
  stopped: t('settings.stopped'),
  unknown: t('settings.unknown')
}))

const tunHint = computed(() => {
  if (!store.tunEnabled) return ''
  return store.running ? t('settings.tunRunning') : t('settings.tunEffective')
})

function svcStateClass(): string {
  switch (store.serviceState.state) {
    case 'running':
      return 'ok'
    case 'not-installed':
      return 'muted'
    default:
      return 'warn'
  }
}

function changeLang(e: Event): void {
  const lang = (e.target as HTMLSelectElement).value as Lang
  currentLang.value = lang
  setLanguage(lang)
}
</script>

<template>
  <div class="settings">
    <div class="card glass">
      <h3>TUN {{ t('settings.tun') }}</h3>
      <p class="hint">
        {{ t('settings.tunHint') }}
        <template v-if="tunHint">· <b class="accent">{{ tunHint }}</b></template>
      </p>
      <p v-if="store.tunPrereq.windows && !store.tunPrereq.wintun" class="err">
        ⚠ {{ t('settings.tunNoWintun') }}
      </p>
      <label class="switch-row">
        <span class="row-label">{{ t('settings.enableTun') }}</span>
        <button
          class="switch"
          :class="{ on: store.tunEnabled }"
          role="switch"
          :aria-checked="store.tunEnabled"
          :disabled="store.busy"
          @click="store.toggleTun(!store.tunEnabled)"
        >
          <span class="knob"></span>
        </button>
      </label>
    </div>

    <div class="card glass">
      <h3>{{ t('settings.appearance') }}</h3>
      <div class="field-row">
        <span class="row-label">{{ t('settings.theme') }}</span>
        <div class="seg">
          <button class="seg-btn" :class="{ on: store.theme === 'dark' }" @click="store.setTheme('dark')">{{ t('settings.dark') }}</button>
          <button class="seg-btn" :class="{ on: store.theme === 'light' }" @click="store.setTheme('light')">{{ t('settings.light') }}</button>
        </div>
      </div>
      <div class="field-row">
        <span class="row-label">{{ t('settings.language') }}</span>
        <select class="select" :value="currentLang" @change="changeLang">
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </div>
    </div>

    <div class="card glass">
      <h3>{{ t('settings.service') }}</h3>
      <p class="hint">{{ t('settings.serviceHint') }}</p>
      <div class="svc-row">
        <span class="row-label">
          {{ t('settings.svcStatus') }}：
          <b :class="svcStateClass()">{{ serviceStateText[store.serviceState.state] ?? store.serviceState.state }}</b>
        </span>
        <div class="svc-actions">
          <button
            class="btn primary"
            :disabled="store.busy || store.serviceState.state === 'running'"
            @click="store.installService()"
          >
            {{ t('settings.installSvc') }}
          </button>
          <button
            class="btn danger"
            :disabled="store.busy || store.serviceState.state === 'not-installed'"
            @click="store.uninstallService()"
          >
            {{ t('settings.uninstallSvc') }}
          </button>
        </div>
      </div>
      <p v-if="store.serviceState.error" class="err">{{ store.serviceState.error }}</p>
      <p class="note">{{ t('settings.svcNote') }}</p>
    </div>

    <div class="card glass">
      <h3>{{ t('settings.about') }}</h3>
      <dl class="kv">
        <dt>{{ t('settings.version') }}</dt>
        <dd>v{{ store.appVersion || '0.1.0' }}</dd>
        <dt>{{ t('settings.license') }}</dt>
        <dd>
          GPL-3.0 ·
          <a class="link" href="https://www.gnu.org/licenses/gpl-3.0.txt">{{ t('settings.licenseText') }}</a>
        </dd>
        <dt>{{ t('home.version') }}</dt>
        <dd>{{ store.status.version?.version ?? '—' }}</dd>
        <dt>{{ t('home.driver') }}</dt>
        <dd>{{ t('status.driverProcess') }}</dd>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}
.card {
  padding: 20px 26px;
}
.card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.hint {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 16px;
  line-height: 1.7;
}
.accent {
  color: var(--accent);
}
.switch-row,
.svc-row,
.field-row,
.path-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  min-height: 44px;
}
.field-row {
  padding: 10px 0;
}
.path-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  padding: 8px 0;
}
.path {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-hover);
  padding: 4px 10px;
  border-radius: 8px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
.row-label b {
  color: var(--text);
}
.seg {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--bg-hover);
  margin-left: auto;
}
.seg-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
}
.seg-btn.on {
  background: var(--accent);
  color: #fff;
}
.select {
  margin-left: auto;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--text);
  font-size: 14px;
}
.svc-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.err {
  color: #f87171;
  font-size: 13px;
  margin: 10px 0 0;
}
.note {
  color: var(--text-faint);
  font-size: 12px;
  margin: 10px 0 0;
}
.kv {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 18px;
  font-size: 15px;
}
.kv dt {
  color: var(--text-dim);
}
.kv dd {
  margin: 0;
  text-align: right;
}
.ok {
  color: #34d399;
}
.muted {
  color: var(--text-faint);
}
.warn {
  color: #fbbf24;
}
.link {
  color: var(--accent);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.switch {
  width: 52px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: var(--bg-hover);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #e2e8f0;
  transition: transform 0.2s;
}
.switch.on {
  background: linear-gradient(135deg, #4f7cff, #38bdf8);
}
.switch.on .knob {
  transform: translateX(24px);
}
.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>