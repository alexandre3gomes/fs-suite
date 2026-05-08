import { expect, test } from '@playwright/test';

import { authenticateAsTestUser } from './helpers/auth';

test.describe('Dashboard (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAsTestUser(page);
    await page.goto('/dashboard');
  });

  test('shows welcome message', async ({ page }) => {
    await expect(
      page.getByText(/welcome|bem-vindo/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('shows sign out button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /sign out|sair/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
