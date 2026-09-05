<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

const driverLabel = () =>
  store.status.driver === 'ffi' ? t('status.driverFfi') : t('status.driverProcess')

const stateMap: Record<string, string> = {
  stopped: t('status.stopped'),
  starting: t('status.starting'),
  running: t('status.running'),
  stopping: t('status.stopping'),
  error: t('status.error')
}

// ---------- 实时流量卡片 ----------
const chart = ref<HTMLCanvasElement | null>(null)
const chartHeight = 64

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${bytesPerSec.toFixed(0)} B/s`
}

function fmtTotal(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

watch(
  () => store.trafficHistory.length,
  async () => {
    await nextTick()
    drawChart()
  }
)

function drawChart(): void {
  const canvas = chart.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.clientWidth * dpr
  canvas.height = chartHeight * dpr
  ctx.scale(dpr, dpr)
  const w = canvas.clientWidth
  const h = chartHeight
  ctx.clearRect(0, 0, w, h)

  const history = store.trafficHistory
  const max = Math.max(1, ...history.map((x) => Math.max(x.down, x.up)))
  const draw = (key: 'down' | 'up', color: string) => {
    if (history.length < 2) return
    ctx.beginPath()
    history.forEach((p, i) => {
      const x = (i / (history.length - 1)) * w
      const y = h - (p[key] / max) * (h - 6) - 3
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    ctx.stroke()
  }
  draw('down', '#38bdf8')
  draw('up', '#a78bfa')
}
</script>

<template>
  <div class="home">
    <section class="hero glass">
      <div class="hero-text">
        <h1>{{ t('home.title') }}</h1>
        <p>{{ t('home.subtitle') }}</p>
      </div>
      <button
        class="power"
        :class="{ running: store.running, busy: store.busy }"
        :disabled="store.busy"
        @click="store.running ? store.stop() : store.start()"
      >
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 3v10" />
          <path d="M6.5 6.5a8 8 0 1 0 11 0" />
        </svg>
        <span>{{ store.running ? t('home.stop') : store.busy ? t('home.busy') : t('home.start') }}</span>
      </button>
    </section>

    <section class="grid">
      <div class="card glass">
        <h3>{{ t('home.coreState') }}</h3>
        <dl class="kv">
          <dt>{{ t('home.state') }}</dt>
          <dd><span class="tag" :class="store.status.state">{{ stateMap[store.status.state] ?? store.status.state }}</span></dd>
          <dt>{{ t('home.driver') }}</dt>
          <dd>{{ driverLabel() }}</dd>
          <dt>{{ t('home.version') }}</dt>
          <dd>{{ store.status.version?.version ?? '—' }}</dd>
        </dl>
      </div>

      <div class="card glass">
        <h3>{{ t('home.sysProxy') }}</h3>
        <p class="hint">{{ t('home.sysProxyHint') }}</p>
        <label class="switch-row">
          <span>{{ t('home.enableSysProxy') }}</span>
          <button
            class="switch"
            :class="{ on: store.systemProxy.enabled }"
            role="switch"
            :aria-checked="store.systemProxy.enabled"
            :disabled="!store.running"
            @click="store.toggleSystemProxy(!store.systemProxy.enabled)"
          >
            <span class="knob"></span>
          </button>
        </label>
      </div>

      <div class="card glass">
        <h3>{{ t('home.traffic') }}</h3>
        <div class="traffic-wrap" :class="{ idle: !store.running }">
          <canvas ref="chart" class="chart" height="64"></canvas>
          <div class="rates">
            <div class="rate">
              <span class="arrow down">↓</span>
              <strong>{{ fmtSpeed(store.traffic?.downloadSpeed ?? 0) }}</strong>
              <span class="dim">{{ t('home.download') }}</span>
            </div>
            <div class="rate">
              <span class="arrow up">↑</span>
              <strong>{{ fmtSpeed(store.traffic?.uploadSpeed ?? 0) }}</strong>
              <span class="dim">{{ t('home.upload') }}</span>
            </div>
            <div class="rate">
              <span class="conn">≡</span>
              <strong>{{ store.traffic?.connections.length ?? 0 }}</strong>
              <span class="dim">{{ t('home.connections') }}</span>
            </div>
          </div>
          <div class="totals dim">
            {{ t('home.total', { down: fmtTotal(store.traffic?.downloadTotal ?? 0), up: fmtTotal(store.traffic?.uploadTotal ?? 0) }) }}
            <span v-if="!store.running" class="stop-hint">{{ t('home.coreStopped') }}</span>
          </div>
        </div>
      </div>

      <div class="card glass">
        <h3>{{ t('home.quickStart') }}</h3>
        <ol class="steps">
          <li v-html="t('home.step1')"></li>
          <li v-html="t('home.step2')"></li>
          <li v-html="t('home.step3')"></li>
        </ol>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 30px 34px;
}
.hero::after {
  content: '';
  position: absolute;
  right: -60px;
  top: -80px;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(79, 124, 255, 0.18), transparent 65%);
  pointer-events: none;
}
.hero-text h1 {
  margin: 0 0 6px;
  font-size: 30px;
  letter-spacing: 2px;
  background: linear-gradient(120deg, #7aa2ff, #38bdf8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-text p {
  margin: 0;
  font-size: 15px;
  color: var(--text-dim);
}
.power {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 26px;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  font-size: 15px;
  color: #e2e8f0;
  background: linear-gradient(135deg, #1e293b, #334155);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
  transition: transform 0.15s, box-shadow 0.2s;
}
.power:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(148, 163, 184, 0.4);
}
.power.running {
  background: linear-gradient(135deg, #065f46, #059669);
  box-shadow: 0 8px 26px rgba(16, 185, 129, 0.3), inset 0 0 0 1px rgba(52, 211, 153, 0.5);
}
.power.busy {
  opacity: 0.7;
  cursor: wait;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 1fr;
  gap: 16px;
}
.card {
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
}
.card h3 {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
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
.tag {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  font-size: 13px;
  background: rgba(100, 116, 139, 0.25);
  color: #cbd5e1;
}
.tag.running {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.tag.starting,
.tag.stopping {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}
.hint {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 16px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
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
.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 15px;
  color: var(--text-dim);
}
.steps b {
  color: var(--text);
}

.traffic-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  justify-content: space-between;
}
.traffic-wrap.idle {
  opacity: 0.6;
}
.chart {
  width: 100%;
  height: 64px;
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.45);
}
.rates {
  display: flex;
  gap: 26px;
}
.rate {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
}
.rate strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.arrow.down {
  color: #38bdf8;
}
.arrow.up {
  color: #a78bfa;
}
.conn {
  color: #34d399;
}
.dim {
  color: var(--text-faint);
  font-size: 12px;
}
.totals {
  margin-top: 2px;
}
.stop-hint {
  color: var(--text-faint);
}
</style>