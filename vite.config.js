import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ollamaScoring } from './server/ollama.js'

export default defineConfig({
  plugins: [react(), ollamaScoring()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
})
