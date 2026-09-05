<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const groupNodes = computed(() => {
  const group = store.currentGroup
  if (!group?.all) return []
  return group.all.map((name) => {
    const p = store.proxies.find((x) => x.name === name)
    const delay = store.delays[name]
    return { name, type: p?.type ?? '', delay }
  })
})

function delayClass(delay: number): string {
  if (delay < 200) return 'fast'
  if (delay < 800) return 'mid'
  return 'slow'
}
</script>

<template>
  <div class="proxies">
    <div class="toolbar glass">
      <div class="groups">
        <span class="label">策略组</span>
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
      <div class="actions">
        <button class="btn ghost" :disabled="!store.running" @click="store.refreshProxies()">刷新</button>
        <button class="btn primary" :disabled="!store.currentGroup?.all?.length || store.batchTest.running" @click="store.testAllNodes()">
          <span v-if="store.batchTest.running">
            批量测速中 {{ store.batchTest.current }}/{{ store.batchTest.total }}
          </span>
          <span v-else>批量测速</span>
        </button>
      </div>
    </div>

    <div class="table-wrap glass">
      <div v-if="!store.running" class="empty">内核未运行，启动后在此查看节点</div>
      <div v-else-if="groupNodes.length === 0" class="empty">该策略组暂无节点</div>
      <table v-else class="nodes">
        <thead>
          <tr>
            <th class="c-name">节点</th>
            <th class="c-type">类型</th>
            <th class="c-delay">延迟</th>
            <th class="c-act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in groupNodes" :key="n.name" :class="{ now: store.currentGroup?.now === n.name }">
            <td class="c-name">
              <span class="now-dot" v-if="store.currentGroup?.now === n.name">●</span>
              <span class="n-name">{{ n.name }}</span>
            </td>
            <td class="c-type"><span class="type-tag">{{ n.type }}</span></td>
            <td class="c-delay">
              <span v-if="!n.delay" class="dim">—</span>
              <span v-else-if="n.delay.delay >= 0 && !n.delay.error" :class="delayClass(n.delay.delay)">
                {{ n.delay.delay }} ms
              </span>
              <span v-else class="fail">超时</span>
            </td>
            <td class="c-act">
              <button class="btn mini" @click="store.testNode(n.name)">测速</button>
              <button
                class="btn mini primary"
                :disabled="store.currentGroup?.now === n.name"
                @click="store.switchNode(n.name)"
              >
                {{ store.currentGroup?.now === n.name ? '已选中' : '切换' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
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
}
.table-wrap {
  flex: 1;
  overflow: auto;
  padding: 6px 12px;
}
.nodes {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}
.nodes th {
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
.nodes td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}
.nodes tr.now {
  background: rgba(79, 124, 255, 0.08);
}
.c-name {
  width: auto;
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
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 15px;
}
</style>