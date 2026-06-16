import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolve workspace `@silkweave/*` imports to TS source in dev via our custom
  // export condition (kept off the published default so external consumers get build/).
  resolve: {
    conditions: ['@silkweave/source', ...defaultClientConditions]
  },
  build: {
    outDir: 'build'
  },
  server: {
    port: 5173,
    proxy: {
      '/trpc': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
