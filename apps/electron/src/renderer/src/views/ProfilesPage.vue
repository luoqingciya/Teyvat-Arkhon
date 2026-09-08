<script setup lang="ts">
import { ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import type { ProfileSubInfo } from '@teyvat-arkhon/shared'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

const url = ref('')
const textName = ref('')
const textContent = ref('')
const shareTip = ref<{ id: string; text: string } | null>(null)

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

/** 字节 -> 人类可读（B/KB/MB/GB/TB） */
function fmtBytes(n: number): string {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/** 已用流量字节（upload + download），无数据返回 null */
function usedBytes(s: ProfileSubInfo | undefined): number | null {
  if (!s || (s.upload === undefined && s.download === undefined)) return null
  return (s.upload ?? 0) + (s.download ?? 0)
}

function quotaPct(s: ProfileSubInfo | undefined): number {
  const used = usedBytes(s)
  if (used === null || !s?.total || s.total <= 0) return 0
  return Math.min(100, Math.round((used / s.total) * 100))
}

/** 到期文案：>0 天显示剩余天数，已过期显示"已到期"；无到期信息返回 null */
function expireText(s: ProfileSubInfo | undefined): string | null {
  if (!s || s.expire === undefined || s.expire <= 0) return null
  const days = (s.expire * 1000 - Date.now()) / 86400000
  if (days < 0) return t('profiles.expired')
  return t('profiles.expiresIn', { days: Math.ceil(days) })
}

/** 将档案节点导出为分享 URI 列表并复制到剪贴板 */
async function shareProfile(id: string): Promise<void> {
  const text = await store.exportProfileUris(id)
  if (!text) {
    shareTip.value = { id, text: t('profiles.shareEmpty') }
  } else {
    try {
      await navigator.clipboard.writeText(text)
      const lines = text.split('\n').filter(Boolean).length
      shareTip.value = { id, text: t('profiles.shareCopied', { n: lines }) }
    } catch {
      shareTip.value = { id, text: t('profiles.shareFailed') }
    }
  }
  setTimeout(() => (shareTip.value = null), 2500)
}

async function submitUrl(): Promise<void> {
  const ok = await store.importFromUrl(url.value)
  if (ok) url.value = ''
}

async function submitText(): Promise<void> {
  const ok = await store.importFromText(textName.value, textContent.value)
  if (ok) {
    textName.value = ''
    textContent.value = ''
  }
}
</script>

<template>
  <div class="profiles">
    <div class="import glass">
      <h3>{{ t('profiles.import') }}</h3>
      <div class="rows">
        <div class="row url-row">
          <input v-model="url" class="input" :placeholder="t('profiles.urlPlaceholder')" @keyup.enter="submitUrl" />
          <button class="btn primary" :disabled="store.busy || !url.trim()" @click="submitUrl">{{ t('profiles.importBtn') }}</button>
        </div>
        <details class="text-toggle">
          <summary>{{ t('profiles.textToggle') }}</summary>
          <div class="row">
            <input v-model="textName" class="input" :placeholder="t('profiles.namePlaceholder')" />
          </div>
          <div class="row">
            <textarea v-model="textContent" class="input ta" rows="5" :placeholder="t('profiles.contentPlaceholder')"></textarea>
          </div>
          <div class="row">
            <button class="btn primary" :disabled="store.busy || !textContent.trim()" @click="submitText">{{ t('profiles.importText') }}</button>
          </div>
        </details>
      </div>
      <p v-if="store.busy" class="busy">{{ t('profiles.processing') }}</p>
    </div>

    <div class="list">
      <div v-if="store.profiles.length === 0" class="empty glass">{{ t('profiles.empty') }}</div>
      <div v-for="p in store.profiles" :key="p.id" class="profile glass" :class="{ selected: p.selected }">
        <div class="p-main">
          <div class="p-title">
            <span v-if="p.selected" class="badge">{{ t('profiles.inUse') }}</span>
            <span class="p-name">{{ p.name }}</span>
          </div>
          <div class="p-meta">
            <span>{{ t('profiles.nodes') }} {{ p.nodeCount ?? '—' }}</span>
            <span class="sep">·</span>
            <span>{{ fmtTime(p.updatedAt) }}</span>
            <span v-if="p.url" class="sep">·</span>
            <span v-if="p.url" class="p-url">{{ p.url }}</span>
          </div>
          <div v-if="usedBytes(p.subInfo) !== null || expireText(p.subInfo)" class="p-quota">
            <div v-if="usedBytes(p.subInfo) !== null" class="quota-line">
              <span class="quota-text">
                {{ t('profiles.usedOfTotal', { used: fmtBytes(usedBytes(p.subInfo)!), total: p.subInfo?.total ? fmtBytes(p.subInfo.total) : '∞' }) }}
              </span>
              <div v-if="p.subInfo?.total" class="quota-bar">
                <div class="quota-fill" :class="{ warn: quotaPct(p.subInfo) > 80 }" :style="{ width: quotaPct(p.subInfo) + '%' }"></div>
              </div>
            </div>
            <span v-if="expireText(p.subInfo)" class="quota-expire" :class="{ overdue: expireText(p.subInfo) === t('profiles.expired') }">
              {{ expireText(p.subInfo) }}
            </span>
          </div>
        </div>
        <div class="p-actions">
          <button class="btn mini primary" :disabled="p.selected" @click="store.selectProfile(p.id)">
            {{ p.selected ? t('profiles.used') : t('profiles.use') }}
          </button>
          <button class="btn mini" :disabled="!p.url" @click="store.refreshProfile(p.id)">{{ t('profiles.refresh') }}</button>
          <button class="btn mini" @click="shareProfile(p.id)">{{ t('profiles.share') }}</button>
          <button class="btn mini danger" @click="store.removeProfile(p.id)">{{ t('profiles.remove') }}</button>
          <span v-if="shareTip && shareTip.id === p.id" class="share-tip">{{ shareTip.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profiles {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.import {
  padding: 20px 26px;
}
.import h3 {
  margin: 0 0 14px;
  font-size: 16px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  gap: 10px;
}
.text-toggle {
  color: var(--text-dim);
  font-size: 14px;
}
.text-toggle summary {
  cursor: pointer;
  margin-bottom: 10px;
}
.input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s;
}
.input:focus {
  border-color: var(--accent);
}
.ta {
  resize: vertical;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}
.busy {
  font-size: 13px;
  color: var(--text-dim);
  margin: 10px 0 0;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 22px;
  border: 1px solid transparent;
}
.profile.selected {
  border-color: rgba(79, 124, 255, 0.45);
}
.p-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.p-name {
  font-size: 16px;
  font-weight: 600;
}
.badge {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.16);
  color: #34d399;
}
.p-meta {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
}
.p-url {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p-quota {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 460px;
}
.quota-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.quota-text {
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.quota-bar {
  flex: 1;
  min-width: 60px;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-hover);
  overflow: hidden;
}
.quota-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #38bdf8, #34d399);
  transition: width 0.3s;
}
.quota-fill.warn {
  background: linear-gradient(90deg, #fbbf24, #f87171);
}
.quota-expire {
  font-size: 12px;
  color: var(--text-faint);
  flex: none;
}
.quota-expire.overdue {
  color: #f87171;
}
.p-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  position: relative;
}
.share-tip {
  position: absolute;
  right: 0;
  bottom: -22px;
  white-space: nowrap;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.16);
  color: #34d399;
}
.empty {
  padding: 46px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>