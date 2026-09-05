<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import { EditorView, basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

const host = ref<HTMLDivElement | null>(null)
const empty = ref(false)
const saving = ref(false)
const savedAt = ref('')

let view: EditorView | null = null
let content = ''

function initEditor(text: string): void {
  content = text
  empty.value = !text.trim()
  if (!host.value || view) return
  view = new EditorView({
    doc: text,
    parent: host.value,
    extensions: [
      basicSetup,
      yaml(),
      oneDark,
      EditorView.updateListener.of((u) => {
        content = u.state.doc.toString()
      })
    ]
  })
}

onMounted(async () => {
  const text = await window.arkhon.getActiveConfig()
  initEditor(text)
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

async function save(): Promise<void> {
  saving.value = true
  try {
    const summary = await window.arkhon.saveActiveConfig(content)
    empty.value = false
    savedAt.value = new Date().toLocaleTimeString()
    store.refreshStatus()
    void summary
  } catch (e) {
    store.error = `${t('config.errorSaving')}: ${(e as Error).message}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="editor-page">
    <div class="toolbar glass">
      <h3>{{ t('config.title') }}</h3>
      <div class="actions">
        <span class="hint">{{ t('config.hint') }}</span>
        <span v-if="savedAt" class="saved">✓ {{ t('config.saved') }} {{ savedAt }}</span>
        <button class="btn primary" :disabled="saving || empty" @click="save">
          {{ saving ? '…' : t('config.save') }}
        </button>
      </div>
    </div>

    <div v-if="empty" class="empty glass">{{ t('config.empty') }}</div>
    <div v-else ref="host" class="codemirror glass"></div>
  </div>
</template>

<style scoped>
.editor-page {
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
  flex-wrap: wrap;
}
.toolbar h3 {
  margin: 0;
  font-size: 16px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  max-width: 420px;
}
.saved {
  font-size: 13px;
  color: #34d399;
}
.codemirror {
  flex: 1;
  overflow: hidden;
  padding: 4px;
}
.codemirror :deep(.cm-editor) {
  height: 100%;
  font-size: 13.5px;
}
.codemirror :deep(.cm-editor.cm-focused) {
  outline: none;
}
.codemirror :deep(.cm-scroller) {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  line-height: 1.6;
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>