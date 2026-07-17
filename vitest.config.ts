import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      // worker 端以 wrangler 的 Text rule 匯入 .md；測試環境用這個 plugin 模擬。
      name: 'markdown-as-string',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('.md')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))}`
        }
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
