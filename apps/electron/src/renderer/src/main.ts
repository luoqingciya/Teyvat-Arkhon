import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'
import { useAppStore } from './stores/app'

const app = createApp(App)
app.use(createPinia())

const store = useAppStore()
void store.init()

app.mount('#app')