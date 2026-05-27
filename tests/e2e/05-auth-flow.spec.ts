import { test, expect } from '@playwright/test';

/**
 * Smoke test: sign-in / sign-up flow happy path.
 * Non testa l'autenticazione vera (richiede DB), solo che le form
 * rendano e validino input di base.
 */

test.describe('Auth flow', () => {
  test('sign-in form renders and validates', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText(/Accedi/i);
  });

  test('sign-up form has role selector', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page.locator('text=Acquirente')).toBeVisible();
    await expect(page.locator('text=Venditore')).toBeVisible();
    await expect(page.locator('text=Rider')).toBeVisible();
  });

  test('sign-up requires Terms acceptance', async ({ page }) => {
    await page.goto('/sign-up');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password1234');
    await page.click('button[type="submit"]');
    // Toast con "Devi accettare Termini e Privacy"
    await expect(page.locator('text=/Termini|accettare/i')).toBeVisible({ timeout: 3000 });
  });

  test('protected route redirects unauthenticated to sign-in', async ({ page }) => {
    await page.goto('/profile/settings');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });
});
