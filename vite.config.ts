import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 本地開發時把 API 代理到 `npm run dev:worker`（wrangler dev，預設 8787 port）。
    proxy: {
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
})
