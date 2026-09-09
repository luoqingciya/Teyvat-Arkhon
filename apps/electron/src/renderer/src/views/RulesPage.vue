<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTranslation } from 'i18next-vue'
import * as RULES_CONST from '@teyvat-arkhon/shared'
import type {
  RuleDebugResult,
  RuleEditorState,
  RuleEntry,
  RuleLineValidation,
  RulePreset,
  RuleProvider,
  RuleProviderPreview
} from '@teyvat-arkhon/shared'
import { useAppStore } from '../stores/app'

// 具名常量经命名空间再解构，规避 rollup 对 shared CJS `__exportStar` 桶的静态分析限制
const { RULE_PRESETS, RULE_TYPES, RULE_TYPE_HINTS } = RULES_CONST

const store = useAppStore()
const { t } = useTranslation()

type TabKey = 'editor' | 'providers' | 'presets' | 'debug'

const hasConfig = ref(false)
const activeTab = ref<TabKey>('editor')
const busy = ref(false)
const savedAt = ref('')
const error = ref('')

// ---- Tab1 规则编辑器 ----
const rules = ref<RuleEntry[]>([])
const validations = ref<RuleLineValidation[]>([])
const validated = ref(false)

// ---- Tab2 规则集 ----
const providers = ref<RuleProvider[]>([])
const previewBox = ref<RuleProviderPreview | null>(null)

// ---- Tab4 命中调试 ----
const debugTarget = ref('')
const debugResult = ref<RuleDebugResult | null>(null)
const debugging = ref(false)

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'editor', label: t('rules.tabs.editor') },
  { key: 'providers', label: t('rules.tabs.providers') },
  { key: 'presets', label: t('rules.tabs.presets') },
  { key: 'debug', label: t('rules.tabs.debug') }
]

/** 运行时命中统计（来自内核 /rules），用于在编辑行展示当前命中数 */
const hitsMap = computed(() => {
  const m = new Map<string, number>()
  if (!store.rules) return m
  for (const r of store.rules) {
    m.set(`${r.type}\u0000${r.payload ?? ''}`, (m.get(`${r.type}\u0000${r.payload ?? ''}`) ?? 0) + r.hits)
  }
  return m
})

const invalidCount = computed(() => validations.value.filter((v) => !v.ok).length)
const issueHint = computed(() => {
  if (!validated.value) return ''
  if (invalidCount.value === 0) return t('rules.editor.allOk')
  return t('rules.editor.issues', { n: invalidCount.value })
})

async function load(): Promise<void> {
  busy.value = true
  try {
    const active = await window.arkhon.getActiveConfig()
    hasConfig.value = active.trim().length > 0
    const state: RuleEditorState = await window.arkhon.getRuleEditorState()
    rules.value = state.rules ?? []
    providers.value = state.providers ?? []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function validate(): Promise<void> {
  validated.value = true
  try {
    validations.value = await window.arkhon.validateRuleLines(rules.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function save(): Promise<void> {
  busy.value = true
  try {
    await window.arkhon.saveRuleEditorState({ rules: rules.value, providers: providers.value })
    savedAt.value = new Date().toLocaleTimeString()
    await validate()
    await store.refreshRules?.()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function addRule(): void {
  rules.value.push({ type: 'DOMAIN-SUFFIX', payload: '', proxy: '' })
  validated.value = false
}

function move(i: number, dir: -1 | 1): void {
  const j = i + dir
  if (j < 0 || j >= rules.value.length) return
  const arr = rules.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  validated.value = false
}

function removeRule(i: number): void {
  rules.value.splice(i, 1)
  validated.value = false
}

function validationAt(i: number): RuleLineValidation | undefined {
  return validations.value[i]
}

function hitsOf(r: RuleEntry): number | null {
  const v = hitsMap.value.get(`${r.type}\u0000${r.payload ?? ''}`)
  return v === undefined ? null : v
}

// ---- Tab2 规则集 ----
function addProvider(): void {
  providers.value.push({ name: '', type: 'http', behavior: 'domain', url: '', interval: 60 })
}

function removeProvider(i: number): void {
  providers.value.splice(i, 1)
}

async function preview(p: RuleProvider): Promise<void> {
  previewBox.value = null
  try {
    previewBox.value = await window.arkhon.previewRuleProvider(p)
  } catch (e) {
    previewBox.value = { name: p.name || '?', remote: p.type === 'http', count: 0, lines: [], error: (e as Error).message }
  }
}

// ---- Tab3 预设 ----
async function applyPreset(preset: RulePreset): Promise<void> {
  let entries = preset.rules.map((r) => ({ type: r.type, payload: r.payload ?? '', proxy: r.proxy ?? '' }))
  if (entries.some((r) => r.proxy === '__PROXY__')) {
    const target = window.prompt(
      t('rules.presets.policyPrompt', { name: preset.name }),
      store.selectedGroup || 'PROXY'
    )
    if (target === null) return
    const policy = target.trim()
    if (!policy) return
    entries = entries.map((r) => ({ ...r, proxy: r.proxy === '__PROXY__' ? policy : r.proxy }))
  }
  if (preset.id === 'cn-direct') {
    // 中国大陆直连：插到 MATCH 之前（末尾）
    const matchIdx = rules.value.findIndex((r) => (r.type ?? '').toUpperCase() === 'MATCH')
    if (matchIdx >= 0) rules.value.splice(matchIdx, 0, ...entries)
    else rules.value.push(...entries)
  } else {
    rules.value.unshift(...entries)
  }
  validated.value = false
  await save()
}

// ---- Tab4 命中调试 ----
async function runDebug(): Promise<void> {
  const target = debugTarget.value.trim()
  if (!target) return
  debugging.value = true
  debugResult.value = null
  try {
    debugResult.value = await window.arkhon.debugRuleHit(target, rules.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    debugging.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="rules-page">
    <div class="head glass">
      <div>
        <h3>{{ t('rules.title') }}</h3>
        <p class="hint">{{ t('rules.hint') }}</p>
      </div>
      <span v-if="savedAt" class="saved">✓ {{ t('rules.editor.saved') }} · {{ savedAt }}</span>
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

    <div v-if="!hasConfig" class="empty glass">{{ t('rules.editor.noConfig') }}</div>

    <template v-else>
      <!-- ============ Tab1 规则编辑器 ============ -->
      <section v-if="activeTab === 'editor'" class="card glass">
        <div class="card-head">
          <div class="toolbar">
            <span class="count" v-if="rules.length">共 {{ rules.length }} 条</span>
            <button class="btn" :disabled="busy" @click="addRule">{{ t('rules.editor.add') }}</button>
            <button class="btn" :disabled="busy" @click="validate">{{ t('rules.editor.validate') }}</button>
            <button class="btn primary" :disabled="busy" @click="save">{{ t('rules.editor.save') }}</button>
            <span class="issue" :class="{ ok: validated && invalidCount === 0 }">{{ issueHint }}</span>
          </div>
        </div>

        <div v-if="rules.length === 0" class="rules-empty">{{ t('rules.editor.placeholder') }}</div>

        <table v-else class="rules-table">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>{{ t('rules.editor.type') }}</th>
              <th>{{ t('rules.editor.payload') }}</th>
              <th>{{ t('rules.editor.proxy') }}</th>
              <th class="num">{{ t('rules.editor.hits') }}</th>
              <th class="act">{{ t('rules.editor.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in rules"
              :key="i"
              :class="{ invalid: validated && !validationAt(i)?.ok }"
            >
              <td class="num row">
                {{ i + 1 }}
                <span v-if="(r.type || '').toUpperCase() === 'MATCH' && i !== rules.length - 1" class="flag warn">
                  {{ t('rules.editor.matcherHint') }}
                </span>
              </td>
              <td>
                <select v-model="r.type" class="inp sel" @change="validated = false">
                  <option v-for="tt in RULE_TYPES" :key="tt" :value="tt">{{ tt }}</option>
                </select>
              </td>
              <td>
                <input
                  v-model="r.payload"
                  class="inp"
                  :placeholder="RULE_TYPE_HINTS[r.type] || ''"
                  :disabled="(r.type || '').toUpperCase() === 'MATCH'"
                  @input="validated = false"
                />
              </td>
              <td>
                <input v-model="r.proxy" class="inp" placeholder="DIRECT / REJECT / 组名" @input="validated = false" />
              </td>
              <td class="num row">
                {{ hitsOf(r) === null ? '—' : hitsOf(r) }}
                <span v-if="hitsOf(r) === 0" class="flag">0</span>
              </td>
              <td class="act">
                <button class="mini" :disabled="i === 0" @click="move(i, -1)">↑</button>
                <button class="mini" :disabled="i === rules.length - 1" @click="move(i, 1)">↓</button>
                <button class="mini danger" @click="removeRule(i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="validated" class="vbar">
          <span v-for="(v, i) in validations" :key="i" :class="['vd', v.ok ? 'ok' : 'bad']">
            {{ i + 1 }} {{ v.message }}
          </span>
        </div>
      </section>

      <!-- ============ Tab2 规则集 ============ -->
      <section v-if="activeTab === 'providers'" class="card glass">
        <div class="card-head">
          <div class="toolbar">
            <h4>{{ t('rules.providers.title') }}</h4>
            <button class="btn" :disabled="busy" @click="addProvider">{{ t('rules.providers.add') }}</button>
            <button class="btn primary" :disabled="busy" @click="save">{{ t('common.save') }}</button>
          </div>
        </div>

        <div v-if="providers.length === 0" class="rules-empty">{{ t('rules.providers.empty') }}</div>

        <table v-else class="rules-table">
          <thead>
            <tr>
              <th>{{ t('rules.providers.name') }}</th>
              <th>类型</th>
              <th>语义</th>
              <th>URL / 路径</th>
              <th class="num">{{ t('rules.providers.interval') }}</th>
              <th class="act">{{ t('rules.editor.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in providers" :key="i">
              <td><input v-model="p.name" class="inp" /></td>
              <td>
                <select v-model="p.type" class="inp sel">
                  <option value="http">{{ t('rules.providers.typeRemote') }}</option>
                  <option value="file">{{ t('rules.providers.typeLocal') }}</option>
                </select>
              </td>
              <td>
                <select v-model="p.behavior" class="inp sel">
                  <option value="domain">{{ t('rules.providers.behaviorDomain') }}</option>
                  <option value="ipcidr">{{ t('rules.providers.behaviorIp') }}</option>
                </select>
              </td>
              <td>
                <input v-if="p.type === 'http'" v-model="p.url" class="inp" placeholder="https://example.com/clash/rule.txt" />
                <input v-else v-model="p.file" class="inp" placeholder="./rules/example.txt" />
              </td>
              <td class="num">
                <input v-if="p.type === 'http'" v-model.number="p.interval" type="number" min="1" class="inp num-inp" />
              </td>
              <td class="act">
                <button class="mini" @click="preview(p)">👁 {{ t('rules.providers.preview') }}</button>
                <button class="mini danger" @click="removeProvider(i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="previewBox" class="preview glass">
          <div class="pv-head">
            <strong>{{ t('rules.providers.previewTitle') }} · {{ previewBox.name }}</strong>
            <span v-if="previewBox.error" class="bad">
              {{ t('rules.providers.error') }}: {{ previewBox.error }}
            </span>
            <span v-else>{{ t('rules.providers.count', { count: previewBox.count }) }}</span>
          </div>
          <pre v-if="previewBox.lines.length" class="pv-body">{{ previewBox.lines.join('\n') }}</pre>
        </div>
      </section>

      <!-- ============ Tab3 预设 ============ -->
      <section v-if="activeTab === 'presets'" class="card glass">
        <div class="card-head"><h4>{{ t('rules.presets.title') }}</h4></div>
        <p class="hint">{{ t('rules.presets.hint') }}</p>
        <div class="preset-grid">
          <div v-for="p in RULE_PRESETS" :key="p.id" class="preset">
            <div class="p-name">{{ p.name }}</div>
            <p class="p-desc">{{ p.desc }}</p>
            <div class="p-rules">
              <span v-for="(r, i) in p.rules" :key="i" class="chip">{{ r.type }}{{ r.payload ? ',' + r.payload : '' }} → {{ r.proxy }}</span>
            </div>
            <button class="btn primary" :disabled="busy || rules.length === 0" @click="applyPreset(p)">
              {{ t('rules.presets.apply') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ============ Tab4 命中调试 ============ -->
      <section v-if="activeTab === 'debug'" class="card glass">
        <div class="card-head"><h4>{{ t('rules.debug.title') }}</h4></div>
        <p class="hint">{{ t('rules.debug.hint') }}</p>
        <div class="debug-bar">
          <input v-model="debugTarget" class="inp grow" :placeholder="t('rules.debug.target')" @keyup.enter="runDebug" />
          <button class="btn primary" :disabled="debugging || !debugTarget.trim()" @click="runDebug">
            {{ t('rules.debug.run') }}
          </button>
        </div>

        <template v-if="debugResult">
          <div class="debug-result" :class="debugResult.matched ? 'hit' : 'miss'">
            <strong>{{ t('rules.debug.matched') }}:</strong>
            <template v-if="debugResult.matched">
              <code class="code">{{ debugResult.matched.type }}<template v-if="debugResult.matched.payload">,{{ debugResult.matched.payload }}</template> → {{ debugResult.matched.proxy }}</code>
            </template>
            <template v-else>{{ t('rules.debug.none') }}</template>
            <span class="dim">· {{ debugResult.method }}</span>
          </div>
          <table class="rules-table">
            <thead>
              <tr>
                <th class="num">{{ t('rules.debug.step') }}</th>
                <th>{{ t('rules.debug.rule') }}</th>
                <th class="num">{{ t('rules.debug.matched') }}</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in debugResult.steps" :key="s.index" :class="{ hit: s.matched }">
                <td class="num">{{ s.index + 1 }}</td>
                <td><code class="code">{{ s.rendered }}</code></td>
                <td class="num">{{ s.matched ? '✓' : '✗' }}</td>
                <td class="dim">{{ s.reason || '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rules-page {
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
.hint { font-size: 12.5px; color: var(--text-dim); margin: 4px 0 0; line-height: 1.6; }
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
  box-shadow: inset 0 0 0 1px rgba(79, 124, 255, 0.3);
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
.count { font-size: 13px; color: var(--text-dim); padding: 4px 10px; background: var(--bg-hover); border-radius: 999px; }
.issue { font-size: 12.5px; color: #fbbf24; }
.issue.ok { color: #34d399; }

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

.rules-empty { padding: 26px; text-align: center; color: var(--text-faint); font-size: 14px; }

.rules-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.rules-table th {
  text-align: left; font-weight: 600; color: var(--text-dim);
  padding: 8px 8px; border-bottom: 1px solid var(--border); font-size: 12.5px;
}
.rules-table td { padding: 5px 8px; border-bottom: 1px solid rgba(130, 140, 170, 0.12); vertical-align: middle; }
.rules-table tr.invalid td { background: rgba(244, 63, 94, 0.1); }
.rules-table tr.hit td { background: rgba(52, 211, 153, 0.08); }
.num { text-align: center; width: 40px; }
.num.row { font-variant-numeric: tabular-nums; }
.act { white-space: nowrap; text-align: right; width: 110px; }

.inp {
  width: 100%; padding: 6px 9px; border: 1px solid var(--border); border-radius: 8px;
  background: rgba(10, 12, 20, 0.5); color: var(--text); font-size: 13.5px; min-width: 0;
}
.inp:focus { outline: none; border-color: rgba(79, 124, 255, 0.6); }
.inp.sel { width: auto; }
.inp.num-inp { width: 64px; }
.inp:disabled { opacity: 0.5; }

.mini {
  padding: 3px 8px; margin-left: 4px; border: 1px solid var(--border); border-radius: 7px;
  background: rgba(130, 140, 170, 0.12); color: var(--text-dim); font-size: 12.5px; cursor: pointer;
}
.mini:hover { background: rgba(79, 124, 255, 0.16); }
.mini.danger:hover { background: rgba(244, 63, 94, 0.18); }
.mini:disabled { opacity: 0.35; cursor: not-allowed; }

.flag { margin-left: 6px; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
.flag.warn { background: rgba(251, 191, 36, 0.18); color: #fcd34d; }

.vbar { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 12.5px; }
.vd { padding: 4px 10px; border-radius: 8px; }
.vd.ok { color: #34d399; background: rgba(52, 211, 153, 0.08); }
.vd.bad { color: #fda4af; background: rgba(244, 63, 94, 0.1); }

.preview { margin-top: 12px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.pv-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-hover); font-size: 13px; }
.pv-head .bad { color: #fda4af; }
.pv-body { margin: 0; padding: 12px 14px; max-height: 240px; overflow: auto; font-size: 12px; line-height: 1.65; font-family: ui-monospace, Consolas, monospace; color: var(--text-dim); }

.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
.preset { border: 1px solid var(--border); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.p-name { font-weight: 700; font-size: 15px; }
.p-desc { margin: 0; color: var(--text-dim); font-size: 12.5px; min-height: 34px; }
.p-rules { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
.chip { font-size: 11.5px; padding: 3px 8px; border-radius: 8px; background: rgba(79, 124, 255, 0.12); color: #a5b8ff; }

.debug-bar { display: flex; gap: 10px; margin-top: 10px; }
.debug-bar .grow { flex: 1; }
.debug-result { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-radius: 10px; margin: 12px 0; font-size: 13.5px; }
.debug-result.hit { background: rgba(52, 211, 153, 0.12); }
.debug-result.miss { background: rgba(251, 191, 36, 0.1); }
.code { font-family: ui-monospace, Consolas, monospace; font-size: 13px; color: #7dd3fc; }
.dim { color: var(--text-faint); font-size: 12px; }
</style>