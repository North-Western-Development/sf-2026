import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-server proxy mirrors docker/nginx/web.conf so the client always talks to its own origin.
const BACKEND_HOST = process.env.VITE_BACKEND_HOST || '127.0.0.1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api/v1/vault': { target: `http://${BACKEND_HOST}:3003`, changeOrigin: true },
      '/api': { target: `http://${BACKEND_HOST}:3001`, changeOrigin: true },
      '/gateway': { target: `ws://${BACKEND_HOST}:3002`, ws: true },
      '/rtc': { target: `ws://${BACKEND_HOST}:7880`, ws: true },
      '/subspace-vault': { target: `http://${BACKEND_HOST}:9000` },
    },
  },
});
