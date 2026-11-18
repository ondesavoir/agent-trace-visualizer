import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: forward API calls to the Rust backend (127.0.0.1:8601 — the same
    // port the legacy Streamlit app used, kept for the Ora iframe contract).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8601',
        changeOrigin: false,
      },
    },
  },
})
