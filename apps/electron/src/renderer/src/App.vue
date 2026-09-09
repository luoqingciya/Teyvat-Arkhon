<script setup lang="ts">
import { useAppStore } from './stores/app'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import HomePage from './views/HomePage.vue'
import ProxiesPage from './views/ProxiesPage.vue'
import ProfilesPage from './views/ProfilesPage.vue'
import RulesPage from './views/RulesPage.vue'
import DnsPage from './views/DnsPage.vue'
import ConnectionsPage from './views/ConnectionsPage.vue'
import ConfigEditorPage from './views/ConfigEditorPage.vue'
import SettingsPage from './views/SettingsPage.vue'
import LogsPage from './views/LogsPage.vue'

const store = useAppStore()
</script>

<template>
  <div class="app">
    <Sidebar />
    <div class="main-col">
      <main class="content">
        <transition name="page" mode="out-in">
          <HomePage v-if="store.activeView === 'home'" key="home" />
          <ProxiesPage v-else-if="store.activeView === 'proxies'" key="proxies" />
          <ProfilesPage v-else-if="store.activeView === 'profiles'" key="profiles" />
          <RulesPage v-else-if="store.activeView === 'rules'" key="rules" />
          <DnsPage v-else-if="store.activeView === 'dns'" key="dns" />
          <ConnectionsPage v-else-if="store.activeView === 'connections'" key="connections" />
          <ConfigEditorPage v-else-if="store.activeView === 'config'" key="config" />
          <SettingsPage v-else-if="store.activeView === 'settings'" key="settings" />
          <LogsPage v-else-if="store.activeView === 'logs'" key="logs" />
        </transition>
      </main>
      <StatusBar />
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(79, 124, 255, 0.12), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(56, 189, 248, 0.09), transparent 55%),
    var(--bg);
  color: var(--text);
  font-family:
    'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 15px;
}
.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  min-height: 0;
  padding: 20px 26px;
  overflow: auto;
}
/* 页面切换过渡 */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>