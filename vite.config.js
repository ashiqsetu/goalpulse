import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev proxy: /api/* -> Netlify function (netlify/functions/api.mjs)
// so local dev behaves exactly like production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
