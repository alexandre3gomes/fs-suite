import type { Page } from '@playwright/test';

const MOCK_USER = {
  id: 'e2e-test-user-001',
  email: 'pilot@e2e.test',
  name: 'E2E Test Pilot',
  avatarUrl: null,
};

const MOCK_ACCESS_TOKEN = 'e2e-mock-access-token';

/**
 * Authenticate the page by injecting a mock auth state into the Zustand store
 * and intercepting API calls that require auth.
 *
 * This bypasses Google OAuth entirely for e2e tests. The mock intercepts
 * /v1/users/me and /v1/auth/refresh so the app thinks it has a valid session.
 */
export async function authenticateAsTestUser(page: Page): Promise<void> {
  // Intercept auth refresh — return mock tokens
  await page.route('**/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: MOCK_ACCESS_TOKEN }),
    }),
  );

  // Intercept user profile — return mock user
  await page.route('**/v1/users/me', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    }
    return route.continue();
  });
}

export { MOCK_USER, MOCK_ACCESS_TOKEN };
