import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process/* eslint-disable-line no-undef */.cwd(), '')
  return {
    // GitHub Pages 需要仓库名作为 base，云平台部署用 '/'
    base: env.VITE_BASE || '/',
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
