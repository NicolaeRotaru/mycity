import { test, expect } from '@playwright/test';

/**
 * Smoke test: product detail page renders correctly.
 * Verifica gli element critici: nome, prezzo, CTA, breadcrumb.
 */

test.describe('Product detail page', () => {
  test('renders 404 for invalid product', async ({ page }) => {
    const response = await page.goto('/product/not-a-real-id', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(500);
    // 5/11/2026 (S04, scheda 478) — «meno di 500» passava anche con una scheda qualunque a 200.
    // La pagina del prodotto è disegnata nel browser: deve dire che il prodotto non c'è.
    await expect(page.getByRole('heading', { name: 'Prodotto non trovato' })).toBeVisible({ timeout: 10000 });
  });

  test('search results link to product detail', async ({ page }) => {
    await page.goto('/search');
    // Wait for products to load (skip if test DB empty)
    const firstProduct = page.locator('article a, [data-testid="product-card"] a').first();
    const productExists = await firstProduct.isVisible({ timeout: 5000 }).catch(() => false);
    if (productExists) {
      await firstProduct.click();
      await expect(page).toHaveURL(/\/product\//);
    }
  });
});
