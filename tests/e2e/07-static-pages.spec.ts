import { test, expect } from '@playwright/test';

/**
 * Smoke test: static pages (Terms, Privacy, FAQ, Contact, etc).
 * Verifica che renderizzino senza errori e abbiano il contenuto base.
 */

const STATIC_PAGES = [
  { path: '/terms', heading: /Termini/i },
  { path: '/privacy', heading: /Privacy/i },
  { path: '/faq', heading: /Domande|FAQ/i },
  { path: '/contact', heading: /Contattaci|Contatto/i },
  { path: '/shipping', heading: /Spedizione/i },
  { path: '/returns', heading: /Resi|Reso/i },
  { path: '/help', heading: /Aiuto|Help/i },
];

test.describe('Static pages render', () => {
  for (const { path, heading } of STATIC_PAGES) {
    test(`${path} renders without errors`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      // h1 può essere assente in static pages minimal; verifica almeno il titolo della pagina
      const title = await page.title();
      expect(title).toBeTruthy();
      // Verifica che qualcosa relativo al heading sia presente
      const bodyText = await page.locator('body').textContent();
      expect(bodyText).toMatch(heading);
    });
  }
});

test.describe('404 handling', () => {
  test('404 page renders for invalid route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-xyz');
    expect(response?.status()).toBe(404);
    await expect(page.locator('text=/404|non trovata/i')).toBeVisible();
  });
});
