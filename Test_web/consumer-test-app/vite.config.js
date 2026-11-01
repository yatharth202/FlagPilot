import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backendTarget = process.env.FLAGPILOT_API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5180,
    strictPort: true,
    proxy: {
      '/flagpilot-api': {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/flagpilot-api/, ''),
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            // This is a server-to-server development proxy, not a browser CORS request.
            // The backend permits requests with no Origin; do not forward the browser Origin.
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
});
