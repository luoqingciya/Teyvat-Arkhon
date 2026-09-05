<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

function fmt(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="connections">
    <div class="toolbar glass">
      <h3>{{ t('connections.title') }}</h3>
      <div class="actions">
        <span v-if="store.traffic" class="hint">
          {{ t('connections.totalHint', { count: store.traffic.connections.length, down: fmt(store.traffic.downloadTotal), up: fmt(store.traffic.uploadTotal) }) }}
        </span>
        <button class="btn danger mini" :disabled="!store.running" @click="store.closeAllConnections()">
          {{ t('connections.closeAll') }}
        </button>
      </div>
    </div>

    <div class="table-wrap glass">
      <div v-if="!store.running" class="empty">{{ t('status.stopped') }}</div>
      <div v-else-if="!store.traffic || store.traffic.connections.length === 0" class="empty">
        {{ t('connections.empty') }}
      </div>
      <table v-else class="ctable">
        <thead>
          <tr>
            <th>{{ t('connections.host') }}</th>
            <th>{{ t('connections.type') }}</th>
            <th>{{ t('connections.network') }}</th>
            <th class="num">{{ t('connections.dl') }}</th>
            <th class="num">{{ t('connections.ul') }}</th>
            <th>{{ t('connections.rule') }}</th>
            <th>{{ t('connections.started') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in store.traffic.connections" :key="c.id">
            <td class="c-host">{{ c.host || '—' }}</td>
            <td>
              <span class="type-tag">{{ c.type || '—' }}{{ c.process ? ' · ' + c.process : '' }}</span>
            </td>
            <td class="c-network">{{ c.network || '—' }}</td>
            <td class="num down">{{ fmt(c.download) }}</td>
            <td class="num up">{{ fmt(c.upload) }}</td>
            <td class="c-rule">
              <span class="rule-badge">{{ c.rule || '—' }}</span>
            </td>
            <td class="c-time">{{ fmtTime(c.start) }}</td>
            <td class="c-act">
              <button class="btn mini danger" @click="store.closeConnection(c.id)">{{ t('connections.close') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.connections {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
}
.toolbar h3 {
  margin: 0;
  font-size: 16px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  font-size: 13px;
  color: var(--text-dim);
}
.table-wrap {
  flex: 1;
  overflow: auto;
  padding: 6px 12px;
}
.ctable {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.ctable th {
  text-align: left;
  padding: 9px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-2);
}
.ctable td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}
.c-host {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
}
.c-network,
.c-time {
  color: var(--text-dim);
  font-size: 13px;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.down {
  color: #38bdf8;
}
.up {
  color: #a78bfa;
}
.type-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}
.rule-badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(100, 116, 139, 0.2);
  color: var(--text-dim);
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>