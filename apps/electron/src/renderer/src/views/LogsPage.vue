<script setup lang="ts">
import { ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()
const copied = ref(false)

function copy(): void {
  const text = store.logs.join('\n')
  navigator.clipboard?.writeText(text).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  })
}
</script>

<template>
  <div class="logs">
    <div class="toolbar glass">
      <h3>{{ t('logs.title') }}</h3>
      <div class="actions">
        <span class="hint">{{ t('logs.hint') }}</span>
        <button class="btn mini" :disabled="!store.logs.length" @click="copy">
          {{ copied ? t('logs.copied') : t('logs.copy') }}
        </button>
        <button class="btn mini" :disabled="!store.logs.length" @click="store.clearLogs()">
          {{ t('logs.clear') }}
        </button>
      </div>
    </div>

    <div class="terminal glass">
      <div v-if="!store.logs.length" class="empty">{{ t('logs.empty') }}</div>
      <pre v-else class="scroll">
<code v-for="(l, i) in store.logs" :key="i">{{ l }}</code>
      </pre>
    </div>
  </div>
</template>

<style scoped>
.logs {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  gap: 10px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
}
.terminal {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  background: rgba(2, 6, 23, 0.55);
}
.scroll {
  margin: 0;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: #a5b4fc;
}
.empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>