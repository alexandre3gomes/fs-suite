import { expect, test } from '@playwright/test';

test.describe('Login screen', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth refresh to return 401 so the app stays unauthenticated
    await page.route('**/v1/auth/refresh', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
    );
  });

  test('shows login page with sign-in button', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText('FS Suite')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/sign in with google|entrar com google/i),
    ).toBeVisible();
  });

  test('sign-in button redirects to Google OAuth', async ({ page }) => {
    // Intercept the OAuth redirect to avoid actually hitting Google
    await page.route('**/v1/auth/google*', (route) =>
      route.fulfill({ status: 200, body: 'OAuth redirect intercepted' }),
    );

    await page.goto('/login');
    const signInButton = page.getByText(/sign in with google|entrar com google/i);
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
  });
});
