import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, proxy: { '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: true }, '/players': { target: 'http://127.0.0.1:8000', changeOrigin: true, ws: true }, '/worlds': { target: 'http://127.0.0.1:8000', changeOrigin: true }, '/dev': { target: 'http://127.0.0.1:8000', changeOrigin: true }, '/backend-health': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: () => '/' } } },
})
