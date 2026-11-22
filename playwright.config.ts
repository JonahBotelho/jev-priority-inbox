// Browser checks run the standalone Vite client against an isolated API process.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: [
    { command: 'tsx tests/browser-jev.ts', url: 'http://127.0.0.1:3102/health', reuseExistingServer: false },
    { command: 'tsx src/server/main.ts', url: 'http://127.0.0.1:3101/v1/health', reuseExistingServer: false,
      env: { PORT: '3101', DATABASE_URL: process.env.JEV_TEST_PG_URL ?? '', JEV_FUNCTION_URL: 'http://127.0.0.1:3102/classify',
        JEV_FUNCTION_SECRET: 'local-browser-fixture', PUBLIC_URL: 'http://127.0.0.1:3101', CLIENT_ORIGIN: 'http://127.0.0.1:5173',
        RENDER_EXTERNAL_URL: '', NODE_ENV: 'test', APP_JWT_SECRET: '', INITIAL_ADMIN_EMAIL: 'admin@example.test', INITIAL_ADMIN_PASSWORD: 'browser-test-only',
        RESEND_API_KEY: '', RESEND_WEBHOOK_SECRET: '' } },
    { command: 'vite --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: false,
      env: { VITE_API_URL: 'http://127.0.0.1:3101' } },
  ],
});
