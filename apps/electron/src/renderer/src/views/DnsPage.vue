<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import * as DNS_CONST from '@teyvat-arkhon/shared'
import type { DnsPreset, DnsSettings } from '@teyvat-arkhon/shared'

const { DNS_PRESETS } = DNS_CONST

const { t } = useTranslation()

type TabKey = 'basic' | 'policy' | 'presets'

const hasConfig = ref(false)
const activeTab = ref<TabKey>('basic')
const busy = ref(false)
const savedAt = ref('')
const error = ref('')

const s = ref<DnsSettings>({
  enable: false,
  enhancedMode: 'redir-host',
  ipv6: false,
  fakeIpRange: '198.18.0.1/16',
  defaultNameserver: [],
  nameserver: [],
  fallback: [],
  nameserverPolicy: []
})

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'basic', label: t('dns.tabs.basic') },
  { key: 'policy', label: t('dns.tabs.policy') },
  { key: 'presets', label: t('dns.tabs.presets') }
]

async function load(): Promise<void> {
  busy.value = true
  try {
    const active = await window.arkhon.getActiveConfig()
    hasConfig.value = active.trim().length > 0
    s.value = await window.arkhon.getDnsState()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  busy.value = true
  try {
    await window.arkhon.saveDnsState(s.value)
    savedAt.value = new Date().toLocaleTimeString()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

// ---- Tab2 域名策略 ----
function addPolicy(): void {
  s.value.nameserverPolicy.push({ domain: '', server: '' })
}
function removePolicy(i: number): void {
  s.value.nameserverPolicy.splice(i, 1)
}

// ---- Tab3 预设 ----
async function applyPreset(preset: DnsPreset): Promise<void> {
  s.value = JSON.parse(JSON.stringify(preset.settings)) as DnsSettings
  await save()
  error.value = ''
}

onMounted(load)
</script>

<template>
  <div class="dns-page">
    <div class="head glass">
      <div>
        <h3>{{ t('dns.title') }}</h3>
        <p class="hint">{{ t('dns.hint') }}</p>
      </div>
      <span v-if="savedAt" class="saved">✓ {{ t('dns.basic.saved') }} · {{ savedAt }}</span>
    </div>

    <nav class="tabs">
      <button
        v-for="tb in tabs"
        :key="tb.key"
        class="tab"
        :class="{ on: activeTab === tb.key }"
        @click="activeTab = tb.key"
      >
        {{ tb.label }}
      </button>
    </nav>

    <div v-if="error" class="banner error">{{ error }}</div>

    <div v-if="!hasConfig" class="empty glass">{{ t('dns.basic.noConfig') }}</div>

    <template v-else>
      <!-- ============ Tab1 解析通道 ============ -->
      <section v-if="activeTab === 'basic'" class="card glass">
        <div class="switches">
          <label class="switch">
            <input v-model="s.enable" type="checkbox" />
            <span class="knob"></span>
            {{ t('dns.basic.enable') }}
          </label>
          <label class="switch">
            <input v-model="s.ipv6" type="checkbox" />
            <span class="knob"></span>
            {{ t('dns.basic.ipv6') }}
          </label>
        </div>

        <div class="field">
          <label class="flabel">{{ t('dns.basic.mode') }}</label>
          <select v-model="s.enhancedMode" class="inp sel">
            <option value="redir-host">{{ t('dns.basic.modeRedir') }}</option>
            <option value="fake-ip">{{ t('dns.basic.modeFake') }}</option>
          </select>
        </div>

        <div class="field">
          <label class="flabel">{{ t('dns.basic.fakeIpRange') }}</label>
          <input v-model="s.fakeIpRange" class="inp" placeholder="198.18.0.1/16" />
        </div>

        <div class="field">
          <label class="flabel">{{ t('dns.basic.defaultNs') }}</label>
          <div v-for="(_, i) in s.defaultNameserver" :key="'dn' + i" class="row">
            <input v-model="s.defaultNameserver[i]" class="inp" :placeholder="t('dns.basic.placeholders.server')" />
            <button class="mini danger" @click="s.defaultNameserver.splice(i, 1)">✕</button>
          </div>
          <button class="btn" @click="s.defaultNameserver.push('')">{{ t('dns.basic.addNs') }}</button>
        </div>

        <div class="field">
          <label class="flabel">{{ t('dns.basic.nameserver') }}</label>
          <div v-for="(_, i) in s.nameserver" :key="'ns' + i" class="row">
            <input v-model="s.nameserver[i]" class="inp" :placeholder="t('dns.basic.placeholders.server')" />
            <button class="mini danger" @click="s.nameserver.splice(i, 1)">✕</button>
          </div>
          <button class="btn" @click="s.nameserver.push('')">{{ t('dns.basic.addNs') }}</button>
        </div>

        <div class="field">
          <label class="flabel">{{ t('dns.basic.fallback') }}</label>
          <div v-for="(_, i) in s.fallback" :key="'fb' + i" class="row">
            <input v-model="s.fallback[i]" class="inp" :placeholder="t('dns.basic.placeholders.server')" />
            <button class="mini danger" @click="s.fallback.splice(i, 1)">✕</button>
          </div>
          <button class="btn" @click="s.fallback.push('')">{{ t('dns.basic.addNs') }}</button>
        </div>

        <div class="card-foot">
          <button class="btn primary" :disabled="busy" @click="save">{{ t('dns.basic.save') }}</button>
        </div>
      </section>

      <!-- ============ Tab2 域名策略 ============ -->
      <section v-if="activeTab === 'policy'" class="card glass">
        <div class="card-head">
          <div class="toolbar">
            <h4>{{ t('dns.policy.title') }}</h4>
            <button class="btn" :disabled="busy" @click="addPolicy">{{ t('dns.policy.add') }}</button>
            <button class="btn primary" :disabled="busy" @click="save">{{ t('dns.basic.save') }}</button>
          </div>
        </div>
        <p class="hint">{{ t('dns.policy.hint') }}</p>

        <div v-if="s.nameserverPolicy.length === 0" class="rules-empty">{{ t('dns.policy.empty') }}</div>

        <table v-else class="rules-table">
          <thead>
            <tr>
              <th>{{ t('dns.policy.domain') }}</th>
              <th>{{ t('dns.policy.server') }}</th>
              <th class="act">{{ t('dns.policy.remove') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in s.nameserverPolicy" :key="i">
              <td>
                <input v-model="p.domain" class="inp" placeholder=".cn / geosite:cn / example.com" />
              </td>
              <td>
                <input v-model="p.server" class="inp" placeholder="223.5.5.5 / 114.114.114.114" />
              </td>
              <td class="act">
                <button class="mini danger" @click="removePolicy(i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ============ Tab3 预设 ============ -->
      <section v-if="activeTab === 'presets'" class="card glass">
        <div class="card-head"><h4>{{ t('dns.presets.title') }}</h4></div>
        <p class="hint">{{ t('dns.presets.hint') }}</p>
        <div class="preset-grid">
          <div v-for="p in DNS_PRESETS" :key="p.id" class="preset">
            <div class="p-name">{{ p.name }}</div>
            <p class="p-desc">{{ p.desc }}</p>
            <div class="p-rules">
              <span class="chip">{{ p.settings.enhancedMode }}</span>
              <span class="chip">nameserver ×{{ p.settings.nameserver.length }}</span>
              <span class="chip">fallback ×{{ p.settings.fallback.length }}</span>
              <span class="chip">policy ×{{ p.settings.nameserverPolicy.length }}</span>
            </div>
            <button class="btn primary" :disabled="busy" @click="applyPreset(p)">
              {{ t('dns.presets.apply') }}
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dns-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
}
.head h3 { margin: 0; font-size: 17px; }
.hint { font-size: 12.5px; color: var(--text-dim); margin: 6px 0 0; line-height: 1.6; }
.saved { font-size: 12px; color: #34d399; white-space: nowrap; }

.tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.tab {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.18s;
}
.tab:hover { background: var(--bg-hover); }
.tab.on {
  background: linear-gradient(135deg, rgba(79, 124, 255, 0.22), rgba(56, 189, 248, 0.14));
  color: var(--accent);
  border-color: rgba(79, 124, 255, 0.45);
}

.banner { padding: 10px 14px; border-radius: 12px; background: rgba(244, 63, 94, 0.14); color: #fda4af; font-size: 13px; }
.empty {
  flex: 1; display: grid; place-items: center;
  color: var(--text-faint); font-size: 15px; padding: 40px;
}

.card { padding: 16px 18px; }
.card-head { margin-bottom: 8px; }
.card-head h4 { margin: 0; font-size: 15px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.card-foot { margin-top: 16px; }

.switches { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 14px; }
.switch {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13.5px; cursor: pointer; user-select: none;
}
.switch input { display: none; }
.switch .knob {
  width: 34px; height: 19px; border-radius: 999px;
  background: rgba(130, 140, 170, 0.28); position: relative; transition: background 0.18s;
}
.switch .knob::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 15px; height: 15px; border-radius: 50%;
  background: #cbd0dd; transition: transform 0.18s, background 0.18s;
}
.switch input:checked + .knob { background: linear-gradient(135deg, #4f7cff, #38bdf8); }
.switch input:checked + .knob::after { transform: translateX(15px); background: #fff; }

.field { margin-bottom: 14px; }
.flabel { display: block; font-size: 12.5px; color: var(--text-dim); margin-bottom: 6px; }
.row { display: flex; gap: 8px; margin-bottom: 8px; }
.row .inp { flex: 1; }

.btn {
  padding: 7px 14px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-hover); color: var(--text); font-size: 13.5px; cursor: pointer; transition: all 0.16s;
}
.btn:hover:not(:disabled) { background: rgba(79, 124, 255, 0.14); }
.btn.primary {
  border-color: transparent;
  background: linear-gradient(135deg, #4f7cff, #38bdf8);
  color: #fff; font-weight: 600;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.inp {
  width: 100%; padding: 6px 9px; border: 1px solid var(--border); border-radius: 8px;
  background: rgba(10, 12, 20, 0.5); color: var(--text); font-size: 13.5px; min-width: 0;
  max-width: 560px;
}
.inp:focus { outline: none; border-color: rgba(79, 124, 255, 0.6); }
.inp.sel { width: auto; }
.inp:disabled { opacity: 0.5; }

.mini {
  padding: 3px 8px; border: 1px solid var(--border); border-radius: 7px;
  background: rgba(130, 140, 170, 0.12); color: var(--text-dim); font-size: 12.5px; cursor: pointer;
}
.mini:hover { background: rgba(79, 124, 255, 0.16); }
.mini.danger:hover { background: rgba(244, 63, 94, 0.18); }

.rules-empty { padding: 26px; text-align: center; color: var(--text-faint); font-size: 14px; }

.rules-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.rules-table th {
  text-align: left; font-weight: 600; color: var(--text-dim);
  padding: 8px 8px; border-bottom: 1px solid var(--border); font-size: 12.5px;
}
.rules-table td { padding: 5px 8px; border-bottom: 1px solid rgba(130, 140, 170, 0.12); vertical-align: middle; }
.act { white-space: nowrap; text-align: right; width: 70px; }

.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
.preset { border: 1px solid var(--border); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.p-name { font-weight: 700; font-size: 15px; }
.p-desc { margin: 0; color: var(--text-dim); font-size: 12.5px; min-height: 34px; }
.p-rules { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
.chip { font-size: 11.5px; padding: 3px 8px; border-radius: 8px; background: rgba(79, 124, 255, 0.12); color: #a5b8ff; }
</style>