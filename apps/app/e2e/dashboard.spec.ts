import { expect, test } from '@playwright/test';

import { authenticateAsTestUser } from './helpers/auth';

test.describe('Dashboard (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAsTestUser(page);
    await page.goto('/dashboard');
  });

  // Retargeted to testIDs: the ops board replaced the old welcome card, so
  // `dashboard.welcome` is no longer rendered anywhere. Asserting on the
  // page's own testIDs also stops the spec breaking on every copy change.
  test('shows the ops board', async ({ page }) => {
    await expect(page.getByTestId('ops-board')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('ops-board-title')).toBeVisible();
  });

  test('shows the readiness grid or the empty state', async ({ page }) => {
    // Which one depends on whether the test user has any flight plan, so
    // accept either rather than depending on seed data.
    const grid = page.getByTestId('readiness-grid');
    const empty = page.getByTestId('ops-board-empty');
    await expect(grid.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test('offers the new flight plan action', async ({ page }) => {
    await expect(page.getByTestId('new-flight-plan')).toBeVisible({ timeout: 15_000 });
  });

  test('signs out from the account menu', async ({ page }) => {
    // Sign-out moved into the account menu, so it is not visible until the
    // trigger is pressed.
    await page.getByTestId('account-menu-trigger').click();
    await expect(page.getByTestId('sign-out')).toBeVisible({ timeout: 15_000 });
  });
});
