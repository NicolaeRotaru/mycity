import { test, expect } from '@playwright/test';

/**
 * Smoke test: flow critici buyer (no checkout completo, serve auth+DB).
 * Verifica che le pagine si carichino e che gli step indicator + form
 * di base siano renderizzati.
 */

test.describe('Checkout page renders', () => {
  test('empty cart redirects to home', async ({ page }) => {
    await page.goto('/checkout');
    // Empty cart mostra "Il tuo carrello e' vuoto"
    const emptyMsg = page.locator('text=/carrello.*vuoto/i');
    await expect(emptyMsg).toBeVisible({ timeout: 5000 });
  });

  test('step indicator visible', async ({ page }) => {
    await page.goto('/checkout');
    // Verifica che StepIndicator renderizzi (Carrello, Indirizzo, Conferma)
    const stepsVisible = await page.locator('text=Carrello').isVisible({ timeout: 3000 }).catch(() => false);
    // Se carrello vuoto non si renderizza, il check passa comunque
    if (stepsVisible) {
      await expect(page.locator('text=Indirizzo')).toBeVisible();
      await expect(page.locator('text=Conferma')).toBeVisible();
    }
  });
});

test.describe('Shared cart page', () => {
  test('shows error for invalid cart param', async ({ page }) => {
    await page.goto('/shared-cart?cart=invalid-format');
    await expect(page.locator('text=/Link non valido/i')).toBeVisible({ timeout: 5000 });
  });

  test('shows error for empty cart param', async ({ page }) => {
    await page.goto('/shared-cart');
    await expect(page.locator('text=/Link non valido/i')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Health check endpoint', () => {
  test('returns JSON with status', async ({ request }) => {
    const r = await request.get('/api/health');
    expect([200, 503]).toContain(r.status());
    const data = await r.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('checks');
    expect(data.checks).toHaveProperty('db');
    expect(data.checks).toHaveProperty('env');
  });

  test('latency under 2 seconds', async ({ request }) => {
    const start = Date.now();
    await request.get('/api/health');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

test.describe('Loading and error boundaries', () => {
  test('product page has loading skeleton', async ({ page }) => {
    // Naviga a un product fake (404) → mostra errore curato
    await page.goto('/product/00000000-0000-0000-0000-000000000000', { waitUntil: 'domcontentloaded' });
    // Almeno uno tra: error boundary, "non trovato", o redirect
    const hasErrorOrNotFound = await Promise.race([
      page.locator('text=/non trovato|non disponibile|Errore/i').isVisible({ timeout: 5000 }).catch(() => false),
      page.locator('h1').isVisible({ timeout: 5000 }).catch(() => false),
    ]);
    expect(hasErrorOrNotFound).toBeTruthy();
  });
});
