import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// 桌機與手機共用的純邏輯放在 ../src/shared（ADR-013）。
// Vercel 只安裝 mobile/ 的套件，共用檔案裡 import 的套件一律指到 mobile/node_modules，
// 否則會往上找 ../node_modules，部署時不存在。
const SHARED_DEPS = ['fflate', 'pizzip', 'docxtemplater']

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: [
      { find: '@shared', replacement: here('../src/shared') },
      ...SHARED_DEPS.map(dep => ({ find: new RegExp(`^${dep}$`), replacement: here(`./node_modules/${dep}`) })),
    ],
    dedupe: ['vue'],
  },
  server: {
    // 本機開發：/api 由 `vercel dev` 提供；只跑 `npm run dev` 時轉給它
    proxy: { '/api': 'http://localhost:3000' },
  },
})
