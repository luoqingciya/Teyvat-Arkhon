<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useTranslation()

/** 视图切换：节点列表 / 路由规则 */
const view = ref<'nodes' | 'rules'>('nodes')
/** 按延迟升序排列（未测速/超时的排在最后） */
const sortByDelay = ref(false)
/** 节点搜索关键词 */
const nodeSearch = ref('')
/** 规则搜索关键词 */
const rulesSearch = ref('')
/** 规则是否按命中数排序 */
const rulesSortHits = ref(false)

/** 收藏节点（localStorage 持久化） */
const FAV_KEY = 'arkhon-node-favs'
const favs = ref<string[]>(readFavs())
function readFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function persistFavs(): void {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs.value))
}
function isFav(name: string): boolean {
  return favs.value.includes(name)
}
function toggleFav(name: string): void {
  favs.value = isFav(name) ? favs.value.filter((x) => x !== name) : [...favs.value, name]
  persistFavs()
}

/** 规则列表单次渲染上限（订阅规则可能上千条，避免一次渲染过多 DOM） */
const RULES_RENDER_LIMIT = 800

/** 切到规则视图时懒拉取一次 */
watch(view, (v) => {
  if (v === 'rules' && store.running && store.rules.length === 0) void store.refreshRules()
})

const groupNodes = computed(() => {
  const group = store.currentGroup
  if (!group?.all) return []
  const kw = nodeSearch.value.trim().toLowerCase()
  const nodes = group.all
    .filter((name) => {
      if (!kw) return true
      const p = store.proxies.find((x) => x.name === name)
      return name.toLowerCase().includes(kw) || (p?.type ?? '').toLowerCase().includes(kw)
    })
    .map((name) => {
      const p = store.proxies.find((x) => x.name === name)
      const delay = store.delays[name]
      return { name, type: p?.type ?? '', delay, fav: isFav(name) }
    })
  return [...nodes].sort((a, b) => {
    // 收藏置顶优先
    if (a.fav !== b.fav) return a.fav ? -1 : 1
    if (sortByDelay.value) {
      const da = a.delay?.delay ?? Number.POSITIVE_INFINITY
      const db = b.delay?.delay ?? Number.POSITIVE_INFINITY
      return da - db
    }
    return 0
  })
})

const filteredRules = computed(() => {
  let rules = store.rules
  const kw = rulesSearch.value.trim().toLowerCase()
  if (kw) {
    rules = rules.filter(
      (r) =>
        r.payload.toLowerCase().includes(kw) ||
        r.type.toLowerCase().includes(kw) ||
        r.proxy.toLowerCase().includes(kw)
    )
  }
  if (rulesSortHits.value) rules = [...rules].sort((a, b) => b.hits - a.hits)
  return rules
})

/** 渲染时仅展示前 RULES_RENDER_LIMIT 条，超出提示可搜索 */
const shownRules = computed(() => filteredRules.value.slice(0, RULES_RENDER_LIMIT))

/** 当前组是否为 Select 类型（仅其支持手动切换节点） */
const isSelectView = computed(() => store.currentGroup?.nodeType === 2)

function delayClass(delay: number): string {
  if (delay < 200) return 'fast'
  if (delay < 800) return 'mid'
  return 'slow'
}
</script>

<template>
  <div class="proxies">
    <div class="toolbar glass">
      <div class="left">
        <div class="tabs">
          <button class="tab" :class="{ active: view === 'nodes' }" @click="view = 'nodes'">
            {{ t('proxies.viewNodes') }}
          </button>
          <button class="tab" :class="{ active: view === 'rules' }" @click="view = 'rules'">
            {{ t('proxies.viewRules') }}
          </button>
        </div>

        <div v-if="view === 'nodes'" class="groups">
          <span class="label">{{ t('proxies.groups') }}</span>
          <button
            v-for="g in store.groups"
            :key="g.name"
            class="chip"
            :class="{ active: store.selectedGroup === g.name }"
            @click="store.selectedGroup = g.name"
          >
            <span class="chip-now">{{ g.now ?? g.name }}</span>
            <span class="chip-name">{{ g.name }}</span>
          </button>
        </div>
      </div>

      <div class="actions">
        <template v-if="view === 'nodes'">
          <input v-model="nodeSearch" class="rsearch" type="search" :placeholder="t('proxies.nodeSearch')" />
          <button class="chip-sort" :class="{ on: sortByDelay }" @click="sortByDelay = !sortByDelay">
            {{ t('proxies.sortByDelay') }}
          </button>
          <button class="btn ghost" :disabled="!store.running" @click="store.refreshProxies()">{{ t('proxies.refresh') }}</button>
          <button class="btn primary" :disabled="!store.currentGroup?.all?.length || store.batchTest.running" @click="store.testAllNodes()">
            <span v-if="store.batchTest.running">{{ t('proxies.testing', { cur: store.batchTest.current, total: store.batchTest.total }) }}</span>
            <span v-else>{{ t('proxies.batchTest') }}</span>
          </button>
        </template>
        <template v-else>
          <input v-model="rulesSearch" class="rsearch" type="search" :placeholder="t('proxies.rulesSearch')" />
          <button class="chip-sort" :class="{ on: rulesSortHits }" @click="rulesSortHits = !rulesSortHits">
            {{ t('proxies.rulesSortHits') }}
          </button>
          <button class="btn ghost" :disabled="!store.running" @click="store.refreshRules()">{{ t('proxies.refresh') }}</button>
        </template>
      </div>
    </div>

    <!-- 节点视图 -->
    <div v-if="view === 'nodes'" class="table-wrap glass">
      <div v-if="!store.running" class="empty">{{ t('proxies.empty') }}</div>
      <div v-else-if="groupNodes.length === 0" class="empty">{{ t('proxies.emptyGroup') }}</div>
      <table v-else class="nodes">
        <thead>
          <tr>
            <th class="c-name">{{ t('proxies.node') }}</th>
            <th class="c-type">{{ t('proxies.type') }}</th>
            <th class="c-delay">{{ t('proxies.delay') }}</th>
            <th class="c-act">{{ t('proxies.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in groupNodes" :key="n.name" :class="{ now: store.currentGroup?.now === n.name }">
            <td class="c-name">
              <button class="fav" :class="{ on: n.fav }" :title="t('proxies.fav')" @click="toggleFav(n.name)">
                {{ n.fav ? '★' : '☆' }}
              </button>
              <span class="now-dot" v-if="store.currentGroup?.now === n.name">●</span>
              <span class="n-name">{{ n.name }}</span>
            </td>
            <td class="c-type"><span class="type-tag">{{ n.type }}</span></td>
            <td class="c-delay">
              <span v-if="!n.delay" class="dim">—</span>
              <span v-else-if="n.delay.delay >= 0 && !n.delay.error" :class="delayClass(n.delay.delay)">
                {{ n.delay.delay }} ms
              </span>
              <span v-else class="fail">{{ t('proxies.timeout') }}</span>
            </td>
            <td class="c-act">
              <button class="btn mini" @click="store.testNode(n.name)">{{ t('proxies.test') }}</button>
              <template v-if="isSelectView">
                <button
                  class="btn mini primary"
                  :disabled="store.currentGroup?.now === n.name"
                  @click="store.switchNode(n.name)"
                >
                  {{ store.currentGroup?.now === n.name ? t('proxies.selected') : t('proxies.switch') }}
                </button>
              </template>
              <span v-else class="dim auto-tag">{{ t('proxies.autoPick') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 规则视图 -->
    <div v-else class="table-wrap glass">
      <div v-if="!store.running" class="empty">{{ t('proxies.empty') }}</div>
      <div v-else-if="store.rules.length === 0" class="empty">{{ t('proxies.rulesEmpty') }}</div>
      <template v-else>
        <div class="rules-meta">
          {{ t('proxies.rulesTotal', { count: filteredRules.length }) }}
          <span v-if="shownRules.length < filteredRules.length" class="dim">
            · {{ t('proxies.rulesSearch') }}
          </span>
        </div>
        <table class="rules">
          <thead>
            <tr>
              <th class="r-type">{{ t('proxies.type') }}</th>
              <th class="r-payload">{{ t('proxies.node') }}</th>
              <th class="r-proxy">Proxy</th>
              <th class="r-hits">{{ t('proxies.rulesHits') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in shownRules" :key="i">
              <td class="r-type"><span class="rtag">{{ r.type }}</span></td>
              <td class="r-payload">{{ r.payload }}</td>
              <td class="r-proxy"><span class="ptag">{{ r.proxy }}</span></td>
              <td class="r-hits" :class="{ hot: r.hits > 0 }">{{ r.hits }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.proxies {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 18px;
  flex-wrap: wrap;
}
.left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-hover);
  border-radius: 10px;
  padding: 3px;
}
.tab {
  padding: 7px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  background: rgba(79, 124, 255, 0.16);
  color: var(--accent);
  font-weight: 600;
}
.groups {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.label {
  font-size: 13px;
  color: var(--text-dim);
}
.chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-hover);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.chip:hover {
  border-color: rgba(79, 124, 255, 0.5);
}
.chip.active {
  border-color: var(--accent);
  background: rgba(79, 124, 255, 0.14);
}
.chip-now {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.chip-name {
  font-size: 11px;
  color: var(--text-faint);
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.chip-sort {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.chip-sort:hover {
  border-color: rgba(79, 124, 255, 0.5);
}
.chip-sort.on {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(79, 124, 255, 0.14);
}
.rsearch {
  width: 200px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text);
  font-size: 13px;
}
.rsearch:focus {
  outline: none;
  border-color: var(--accent);
}
.table-wrap {
  flex: 1;
  overflow: auto;
  padding: 6px 12px;
}
.nodes,
.rules {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}
.nodes th,
.rules th {
  text-align: left;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-2);
}
.nodes td,
.rules td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}
.nodes tr.now {
  background: rgba(79, 124, 255, 0.08);
}
.rules {
  font-size: 13.5px;
}
.rules-meta {
  padding: 8px 14px 4px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.rtag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(139, 92, 246, 0.14);
  color: #c4b5fd;
  font-family: ui-monospace, Consolas, monospace;
}
.r-payload {
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
  color: var(--text);
}
.ptag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}
.r-hits {
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}
.r-hits.hot {
  color: #fbbf24;
  font-weight: 700;
}
.n-name {
  margin-left: 6px;
}
.now-dot {
  color: var(--accent);
  font-size: 11px;
}
.type-tag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}
.dim {
  color: var(--text-faint);
}
.fast {
  color: #34d399;
}
.mid {
  color: #fbbf24;
}
.slow {
  color: #f87171;
}
.fail {
  color: #f87171;
}
.c-act {
  display: flex;
  gap: 8px;
  align-items: center;
}
.fav {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 15px;
  padding: 0 2px;
  line-height: 1;
}
.fav:hover {
  color: #fbbf24;
}
.fav.on {
  color: #fbbf24;
}
.auto-tag {
  font-size: 12px;
  font-style: italic;
  user-select: none;
  white-space: nowrap;
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>