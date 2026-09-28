import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// Dev-server proxy mirrors docker/nginx/web.conf so the client always talks to its own origin.
const BACKEND_HOST = process.env.VITE_BACKEND_HOST || '127.0.0.1';

// User-uploaded content must never execute in the app origin (mirrors docker/nginx/web.conf).
const sandboxUserContent = (proxy: any) => {
  proxy.on('proxyRes', (res: any) => {
    res.headers['content-security-policy'] =
      "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
    res.headers['x-content-type-options'] = 'nosniff';
  });
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Consume workspace packages from source: they build to CommonJS for Node services.
    alias: {
      '@subspace/constants': pkg('constants'),
      '@subspace/ui': pkg('ui'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api/v1/vault': { target: `http://${BACKEND_HOST}:3003`, changeOrigin: true },
      '/api/v1/media': { target: `http://${BACKEND_HOST}:3003`, changeOrigin: true },
      '/api': { target: `http://${BACKEND_HOST}:3001`, changeOrigin: true },
      '/gateway': { target: `ws://${BACKEND_HOST}:3002`, ws: true },
      '/rtc': { target: `ws://${BACKEND_HOST}:7880`, ws: true },
      '/subspace-vault': { target: `http://${BACKEND_HOST}:9000`, configure: sandboxUserContent },
      '/subspace-media': { target: `http://${BACKEND_HOST}:9000`, configure: sandboxUserContent },
    },
  },
});
