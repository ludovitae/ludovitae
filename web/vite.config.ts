import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import net from 'node:net'

const HTTPS_TARGET = 'https://localhost:8443'
const HTTP_FALLBACK = 'http://localhost:8000'

/** Probe the HTTPS dev backend; fall back to plain HTTP when 8443 is closed. */
function pickApiTarget(): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: 'localhost', port: 8443 })
    const done = (target: string) => {
      socket.destroy()
      resolve(target)
    }
    socket.once('connect', () => done(HTTPS_TARGET))
    socket.once('error', () => done(HTTP_FALLBACK))
    socket.setTimeout(400, () => done(HTTP_FALLBACK))
  })
}

export default defineConfig(async () => {
  const target = await pickApiTarget()
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: false,
          secure: false, // self-signed dev cert on 8443
        },
      },
    },
  }
})
