// Browser acceptance for registration, role separation, and protected user access.
import { test, expect } from '@playwright/test';

const api = 'http://127.0.0.1:3101/v1';

test('a visitor registers and reaches the user AI service page', async ({ page }) => {
  const anonymous = await page.request.get(`${api}/admin/dashboard`);
  expect(anonymous.status()).toBe(401);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Jev' })).toBeVisible();
  await page.getByRole('button', { name: 'Need an account? Register' }).click();
  await page.getByLabel('Email').fill(`student-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('student-password-for-browser-tests');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Email priority classifier' })).toBeVisible();
  await expect(page.getByText('User', { exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/admin/dashboard`)).status()).toBe(403);
  expect((await page.request.get(`${api}/usage/me`)).status()).toBe(200);
});

test('the seeded administrator sees registered users and the usage dashboard', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('admin-password-for-browser-tests');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Administrator', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Administrator dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Usage dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registered users' })).toBeVisible();
  expect((await page.request.get(`${api}/admin/dashboard`)).status()).toBe(200);
});
