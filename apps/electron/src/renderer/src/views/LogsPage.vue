<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()
const copied = ref(false)
const search = ref('')
/** 级别过滤：'all' 或 debug/info/warning/error（error 含 panic/fatal） */
const levelFilter = ref<'all' | 'debug' | 'info' | 'warning' | 'error'>('all')
const follow = ref(true)
const scrollBox = ref<HTMLDivElement | null>(null)

type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'panic' | 'fatal' | 'unknown'

interface ParsedLog {
  time?: string
  level: LogLevel
  msg: string
}

const OLD_LEVEL_MAP: Record<string, LogLevel> = {
  DBUG: 'debug',
  INFO: 'info',
  WARN: 'warning',
  ERRO: 'error',
  FTL: 'fatal',
  PANIC: 'panic'
}

/** 解析 mihomo 日志行：优先 time=… level=… msg=…（引号包裹），再兼容 logrus 旧格式与时间前缀格式 */
function parseLogLine(line: string): ParsedLog {
  let m = line.match(/^time="([^"]+)"\s+level=(debug|info|warning|error|panic|fatal)\s+msg="([\s\S]*)"$/)
  if (m) return { time: m[1], level: m[2] as LogLevel, msg: m[3] }
  m = line.match(/^level=(debug|info|warning|error|panic|fatal)\s+msg="([\s\S]*)"$/)
  if (m) return { level: m[1] as LogLevel, msg: m[2] }
  m = line.match(/^(DBUG|INFO|WARN|ERRO|FTL|PANIC)\[\d+\]\s?(.*)$/)
  if (m) return { level: OLD_LEVEL_MAP[m[1]], msg: m[2] }
  m = line.match(/^(\d{4}\/\d{2}\/\d{2}[ T]\d{2}:\d{2}:\d{2})\s?(.*)$/)
  if (m) return { time: m[1], level: 'info', msg: m[2] }
  return { level: 'unknown', msg: line }
}

const levelOptions = computed(() => [
  { key: 'all' as const, label: t('logs.lvAll') },
  { key: 'info' as const, label: t('logs.lvInfo') },
  { key: 'warning' as const, label: t('logs.lvWarn') },
  { key: 'error' as const, label: t('logs.lvError') },
  { key: 'debug' as const, label: t('logs.lvDebug') }
])

function matchLevel(level: LogLevel): boolean {
  if (levelFilter.value === 'all') return true
  if (levelFilter.value === 'error') return level === 'error' || level === 'panic' || level === 'fatal'
  return level === levelFilter.value
}

const visibleLogs = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return store.logs
    .map(parseLogLine)
    .filter((l) => {
      if (!matchLevel(l.level)) return false
      if (kw && !l.msg.toLowerCase().includes(kw) && !(l.time ?? '').toLowerCase().includes(kw)) return false
      return true
    })
})

function copy(): void {
  const text = store.logs.join('\n')
  navigator.clipboard?.writeText(text).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  })
}

/** 新日志到达且开启"跟随最新"时自动滚到底部 */
watch(
  () => store.logs.length,
  async () => {
    if (!follow.value) return
    await nextTick()
    const el = scrollBox.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
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

    <div class="filters glass">
      <input v-model="search" class="search" type="search" :placeholder="t('logs.search')" />
      <div class="levels">
        <button
          v-for="opt in levelOptions"
          :key="opt.key"
          class="lv-chip"
          :class="{ on: levelFilter === opt.key }"
          @click="levelFilter = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>
      <label class="follow">
        <input v-model="follow" type="checkbox" />
        <span>{{ t('logs.follow') }}</span>
      </label>
    </div>

    <div class="terminal glass">
      <div v-if="!store.logs.length" class="empty">{{ t('logs.empty') }}</div>
      <div v-else-if="!visibleLogs.length" class="empty">{{ t('logs.noMatch') }}</div>
      <div v-else ref="scrollBox" class="scroll">
        <div v-for="(l, i) in visibleLogs" :key="i" class="line">
          <span v-if="l.time" class="t">{{ l.time }}</span>
          <span v-else class="t dash">—</span>
          <span class="lv" :class="l.level">{{ l.level }}</span>
          <span class="msg">{{ l.msg }}</span>
        </div>
      </div>
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
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 180px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--text);
  font-size: 13px;
}
.search:focus {
  outline: none;
  border-color: var(--accent);
}
.levels {
  display: flex;
  gap: 6px;
}
.lv-chip {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.lv-chip:hover {
  border-color: rgba(79, 124, 255, 0.5);
}
.lv-chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(79, 124, 255, 0.14);
}
.follow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.follow input {
  accent-color: var(--accent);
}
.terminal {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 16px;
  background: rgba(2, 6, 23, 0.55);
}
.scroll {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
}
.line {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 1px 4px;
  border-radius: 4px;
}
.line:hover {
  background: rgba(255, 255, 255, 0.045);
}
.t {
  flex: none;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.t.dash {
  color: var(--text-faint);
}
.lv {
  flex: none;
  width: 58px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.lv.debug {
  color: #64748b;
}
.lv.info {
  color: #38bdf8;
}
.lv.warning {
  color: #fbbf24;
}
.lv.error,
.lv.panic,
.lv.fatal {
  color: #f87171;
}
.lv.unknown {
  color: var(--text-faint);
}
.msg {
  color: #c7d2fe;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>
