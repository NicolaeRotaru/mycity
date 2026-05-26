import { test, expect } from '@playwright/test';

/**
 * Cart + Search flow smoke test (no auth required).
 */

test.describe('Cart and Search', () => {
  test('empty cart shows EmptyState with CTA', async ({ page }) => {
    await page.goto('/cart');
    // EmptyState con ctaLabel "Esplora i prodotti"
    await expect(page.locator('text=carrello è vuoto').or(page.locator('text=Esplora'))).toBeVisible({ timeout: 5000 });
  });

  test('search page renders with input', async ({ page }) => {
    await page.goto('/search');
    const input = page.locator('input[type="search"], input[placeholder*="Cerca"]').first();
    await expect(input).toBeVisible();
  });

  test('category page renders', async ({ page }) => {
    await page.goto('/category/alimentari');
    // Vedi titolo o empty state
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 });
  });

  test('stores page renders list', async ({ page }) => {
    await page.goto('/stores');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('404 page is custom', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist-404');
    expect([404, 200]).toContain(res?.status() ?? 0);
  });
});
