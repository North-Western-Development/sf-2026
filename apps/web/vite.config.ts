import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const BACKEND_HOST = process.env.VITE_BACKEND_HOST || '192.168.1.9';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://${BACKEND_HOST}:3001`,
        changeOrigin: true,
      },
      '/gateway': {
        target: `ws://${BACKEND_HOST}:3002`,
        ws: true,
      },
    },
  },
});
