import { test, expect } from '@playwright/test';

/**
 * Smoke test: home page renders with key sections.
 * Failsafe se cambi qualcosa di critico al layout home.
 */

test.describe('Home page', () => {
  test('renders hero + CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MyCity/);
    await expect(page.locator('h1')).toContainText(/Compra dai negozi/i);
    await expect(page.locator('text=Inizia a esplorare')).toBeVisible();
  });

  test('navigates to search', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Inizia a esplorare');
    await expect(page).toHaveURL(/\/search/);
  });

  test('skip link is keyboard-accessible', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('a:has-text("Vai al contenuto")');
    await expect(skipLink).toBeFocused();
  });

  test('cookie banner is shown on first visit', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');
    await expect(page.locator('text=Accetta tutti').or(page.locator('text=cookie'))).toBeVisible({ timeout: 5000 });
  });
});
