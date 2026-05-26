import { test, expect } from '@playwright/test';

/**
 * Signup buyer end-to-end.
 *
 * Note: skippa in CI se ANTHROPIC_API_KEY / SUPABASE non sono in env.
 * In ambiente locale serve un Supabase project test.
 */

test.describe('Signup flow', () => {
  test('form validates required fields', async ({ page }) => {
    await page.goto('/sign-up');
    // Submit vuoto
    const submit = page.locator('button[type="submit"]');
    await submit.click();
    // HTML5 validation kicks in (email required)
    const email = page.locator('input[type="email"]');
    const isInvalid = await email.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('role selector works', async ({ page }) => {
    await page.goto('/sign-up');
    // 3 role cards visible
    await expect(page.locator('text=Acquirente')).toBeVisible();
    await expect(page.locator('text=Venditore')).toBeVisible();
    await expect(page.locator('text=Rider')).toBeVisible();
  });

  test('navigates to sign-in from sign-up', async ({ page }) => {
    await page.goto('/sign-up');
    await page.click('text=Accedi');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('referral code from URL applied', async ({ page }) => {
    await page.goto('/sign-up?ref=TEST123');
    await expect(page.locator('text=TEST123')).toBeVisible({ timeout: 3000 });
  });
});
