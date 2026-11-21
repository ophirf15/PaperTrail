import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.PAPER_TRAIL_API ?? 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
  },
})
