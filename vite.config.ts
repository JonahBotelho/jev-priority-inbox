import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', emptyOutDir: false },
  // Express owns the HTTP listener. Development rebuilds assets without a second server.
  server: { middlewareMode: true },
  preview: { port: 8000, strictPort: true },
});
