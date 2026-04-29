import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const runtimeProcess = globalThis.process
const WEB_PORT = Number(runtimeProcess.env.APP_WEB_PORT || 3006)
const API_PORT = Number(runtimeProcess.env.APP_API_PORT || 3010)
const API_TARGET = runtimeProcess.env.VITE_API_TARGET || `http://localhost:${API_PORT}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        ws: true,
      },
    },
  },
  preview: {
    port: WEB_PORT,
  },
})
