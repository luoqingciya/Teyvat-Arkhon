<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const serviceStateText: Record<string, string> = {
  'not-installed': '未安装',
  installed: '已安装（未运行）',
  running: '运行中',
  stopped: '已停止',
  unknown: '未知'
}

const tunHint = computed(() => {
  if (!store.tunEnabled) return ''
  return store.running ? '全局模式生效中' : '已写入配置，启动内核后生效'
})

const svcStateClass = (): string => {
  switch (store.serviceState.state) {
    case 'running':
      return 'ok'
    case 'not-installed':
      return 'muted'
    default:
      return 'warn'
  }
}
</script>

<template>
  <div class="settings">
    <div class="card glass">
      <h3>TUN 模式</h3>
      <p class="hint">
        透明代理接管全局流量（含不遵守系统代理的软件）。启用需管理员权限；内核重启后生效。
        <template v-if="tunHint">· <b class="accent">{{ tunHint }}</b></template>
      </p>
      <label class="switch-row">
        <span class="row-label">启用 TUN 模式</span>
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
      <h3>系统服务托管</h3>
      <p class="hint">
        将 mihomo 内核注册为 Windows 服务，实现开机自启、免打开应用常驻（服务运行在进程驱动模式）。
      </p>
      <div class="svc-row">
        <span class="row-label">
          服务状态：
          <b :class="svcStateClass">{{ serviceStateText[store.serviceState.state] ?? store.serviceState.state }}</b>
        </span>
        <div class="svc-actions">
          <button
            class="btn primary"
            :disabled="store.busy || store.serviceState.state === 'running'"
            @click="store.installService()"
          >
            安装并启动
          </button>
          <button
            class="btn danger"
            :disabled="store.busy || store.serviceState.state === 'not-installed'"
            @click="store.uninstallService()"
          >
            卸载
          </button>
        </div>
      </div>
      <p v-if="store.serviceState.error" class="err">{{ store.serviceState.error }}</p>
      <p class="note">安装/卸载会弹出 UAC 授权确认。</p>
    </div>

    <div class="card glass">
      <h3>关于</h3>
      <dl class="kv">
        <dt>版本</dt>
        <dd>v{{ store.appVersion || '0.1.0' }}</dd>
        <dt>协议</dt>
        <dd>GPL-3.0 · <a class="link" href="https://www.gnu.org/licenses/gpl-3.0.txt">许可证文本</a></dd>
        <dt>内核</dt>
        <dd>{{ store.status.version?.version ?? '—' }}</dd>
        <dt>驱动</dt>
        <dd>{{ store.status.driver === 'ffi' ? 'FFI 直连' : '进程模式' }}</dd>
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
.svc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
}
.row-label b {
  color: var(--text);
}
.svc-actions {
  display: flex;
  gap: 10px;
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