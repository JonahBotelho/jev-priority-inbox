import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', emptyOutDir: false },
  server: {
    proxy: {
      // Preserve the browser host so the API can validate same-origin mutations.
      '/v1': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
});
