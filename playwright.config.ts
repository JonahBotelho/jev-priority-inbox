// Browser checks run the standalone Vite client against an isolated API process.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: [
    { command: 'tsx src/server/main.ts', url: 'http://127.0.0.1:3101/v1/health', reuseExistingServer: false,
      env: { PORT: '3101', SQLITE_PATH: ':memory:', JEV_FUNCTION_URL: '', JEV_FUNCTION_SECRET: '' } },
    { command: 'vite --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: false,
      env: { VITE_API_URL: 'http://127.0.0.1:3101' } },
  ],
});
