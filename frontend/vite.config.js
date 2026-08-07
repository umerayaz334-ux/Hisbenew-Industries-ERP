import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import os from 'node:os'

const hostName = os.hostname()
const allowedHosts = [
  hostName,
  hostName.toLowerCase(),
  `${hostName}.local`,
  `${hostName.toLowerCase()}.local`,
  `${hostName}.lan`,
  `${hostName.toLowerCase()}.lan`,
]

const mobileHttpsPfx = process.env.ERP_MOBILE_HTTPS_PFX
const mobileHttps = mobileHttpsPfx && fs.existsSync(mobileHttpsPfx)
  ? {
      pfx: fs.readFileSync(mobileHttpsPfx),
      passphrase: process.env.ERP_MOBILE_HTTPS_PFX_PASSWORD || '',
    }
  : undefined

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts,
    https: mobileHttps,
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts,
    https: mobileHttps,
    proxy: apiProxy,
  },
})
