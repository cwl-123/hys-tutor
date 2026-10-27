import { fileURLToPath, URL } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 将 /api 请求交给 server/ 下的 TS 处理器（经 ssrLoadModule 加载，改后端代码即时生效）
function apiPlugin(): Plugin {
  return {
    name: 'hys-tutor-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, server.config.root, ''))
      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const mod = await server.ssrLoadModule('/server/index.ts')
          await mod.handleApi(req, res, next)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), apiPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // 手机端常经微信/QQ 等内置 WebView（Chrome 87 左右）访问。
    // 默认 CSS 目标会输出 `@media (width<=720px)` 这类新语法，旧 WebView 直接忽略，
    // 响应式样式会整体失效（顶栏又退回挤成一堆的桌面布局），因此降到 Chrome 87 / Safari 15。
    cssTarget: ['chrome87', 'safari15'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
