import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Proxy WS and HTTP to backend during dev
      '/live': {
        target: 'http://localhost:8787',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
