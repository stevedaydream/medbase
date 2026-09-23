import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { applyTheme, installKeyboardWatch } from './lib/ui'
import { startIdleWatch } from './lib/session'

applyTheme()
installKeyboardWatch()
startIdleWatch()

createApp(App).use(router).mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* SW 非必要 */ })
  })
}
