import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
// 尽早应用外观主题（<html data-theme>），避免首屏闪浅色
import './utils/theme'
import './styles/main.css'

createApp(App).use(createPinia()).use(router).mount('#app')
