import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
