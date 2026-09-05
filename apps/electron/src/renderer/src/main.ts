import { createApp } from 'vue'
import { createPinia } from 'pinia'
import i18nPlugin from 'i18next-vue'
import i18next from 'i18next'
import App from './App.vue'
import './styles/main.css'
import { createI18n } from './i18n'
import { applyTheme, readTheme } from './theme'
import { useAppStore } from './stores/app'

applyTheme(readTheme())
createI18n()

const app = createApp(App)
app.use(createPinia())
app.use(i18nPlugin, { i18next })

const store = useAppStore()
void store.init()

app.mount('#app')