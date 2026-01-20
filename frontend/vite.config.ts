import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isDocker = process.env.DOCKER === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4321,
    host: isDocker,
    proxy: {
      '/api': {
        target: isDocker ? 'http://roai-backend:8000' : 'http://localhost:8002',
        changeOrigin: true
      }
    }
  }
})
