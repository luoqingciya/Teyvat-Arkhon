<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

const stateText: Record<string, string> = {
  stopped: t('status.stopped'),
  starting: t('status.starting'),
  running: t('status.running'),
  stopping: t('status.stopping'),
  error: t('status.error')
}
</script>

<template>
  <footer class="statusbar glass">
    <span class="dot" :class="store.status.state"></span>
    <span class="state">{{ stateText[store.status.state] ?? store.status.state }}</span>
    <span class="sep">·</span>
    <span class="driver">{{ t('status.driver') }}: {{ store.status.driver === 'ffi' ? t('status.driverFfi') : t('status.driverProcess') }}</span>
    <template v-if="store.status.version">
      <span class="sep">·</span>
      <span>{{ t('home.version') }} {{ store.status.version.version }}</span>
    </template>
    <span v-if="store.traffic" class="conn-pill">{{ store.traffic.connections.length }}</span>
    <span v-if="store.systemProxy.enabled" class="proxy-on">{{ t('status.sysProxyOn') }}</span>
    <transition name="fade">
      <div v-if="store.error" class="err">{{ store.error }}</div>
    </transition>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  font-size: 13px;
  color: var(--text-dim);
  border-top: 1px solid var(--border);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #64748b;
}
.dot.running {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.8);
  animation: pulse 2s infinite;
}
.dot.starting,
.dot.stopping {
  background: #fbbf24;
}
.dot.error {
  background: #f87171;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
.sep {
  color: var(--text-faint);
}
.proxy-on {
  margin-left: auto;
  color: #34d399;
}
.conn-pill {
  min-width: 20px;
  margin-left: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  text-align: center;
  font-size: 12px;
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.14);
}
.err {
  margin-left: auto;
  color: #f87171;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>