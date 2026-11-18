import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', emptyOutDir: false },
  // The browser app runs on its own origin; API requests go directly to Express.
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 5173, strictPort: true },
});
