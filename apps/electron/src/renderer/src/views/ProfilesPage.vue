<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '../stores/app'
import type { Profile } from '@teyvat-arkhon/shared'

const store = useAppStore()

const url = ref('')
const textName = ref('')
const textContent = ref('')

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
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

function profileActions(p: Profile) {
  return {
    select: () => store.selectProfile(p.id),
    refresh: () => store.refreshProfile(p.id),
    remove: () => store.removeProfile(p.id)
  }
}
</script>

<template>
  <div class="profiles">
    <div class="import glass">
      <h3>导入订阅</h3>
      <div class="rows">
        <div class="row url-row">
          <input v-model="url" class="input" placeholder="粘贴订阅链接 (https://…)" @keyup.enter="submitUrl" />
          <button class="btn primary" :disabled="store.busy || !url.trim()" @click="submitUrl">导入</button>
        </div>
        <details class="text-toggle">
          <summary>从文本导入（分享的 YAML / base64 内容）</summary>
          <div class="row">
            <input v-model="textName" class="input" placeholder="订阅名称（可选）" />
          </div>
          <div class="row">
            <textarea v-model="textContent" class="input ta" rows="5" placeholder="粘贴完整配置内容…"></textarea>
          </div>
          <div class="row">
            <button class="btn primary" :disabled="store.busy || !textContent.trim()" @click="submitText">导入文本</button>
          </div>
        </details>
      </div>
      <p v-if="store.busy" class="busy">处理中…</p>
    </div>

    <div class="list">
      <div v-if="store.profiles.length === 0" class="empty glass">还没有任何订阅，请先导入</div>
      <div v-for="p in store.profiles" :key="p.id" class="profile glass" :class="{ selected: p.selected }">
        <div class="p-main">
          <div class="p-title">
            <span v-if="p.selected" class="badge">使用中</span>
            <span class="p-name">{{ p.name }}</span>
          </div>
          <div class="p-meta">
            <span>节点 {{ p.nodeCount ?? '—' }}</span>
            <span class="sep">·</span>
            <span>{{ fmtTime(p.updatedAt) }}</span>
            <span v-if="p.url" class="sep">·</span>
            <span v-if="p.url" class="p-url">{{ p.url }}</span>
          </div>
        </div>
        <div class="p-actions">
          <template v-if="profileActions(p).select">
            <button class="btn mini primary" :disabled="p.selected" @click="profileActions(p).select()">
              {{ p.selected ? '已使用' : '切换使用' }}
            </button>
            <button class="btn mini" :disabled="!p.url" @click="profileActions(p).refresh()">刷新</button>
          </template>
          <button class="btn mini danger" @click="profileActions(p).remove()">删除</button>
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
.p-actions {
  display: flex;
  gap: 10px;
  flex: none;
}
.empty {
  padding: 46px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>