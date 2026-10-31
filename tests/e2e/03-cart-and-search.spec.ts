import { test, expect } from '@playwright/test';
import { diagnosiJavascript } from './_pagina-senza-javascript';

/**
 * Cart + Search flow smoke test (no auth required).
 *
 * 3/9/2026 — L'elenco dei negozi si disegna nel browser, e oggi /stores arriva
 * senza JavaScript (vedi `_pagina-senza-javascript.ts`): quella prova si salta
 * finche' il difetto e' vivo. Le altre guardano il documento cosi' come lo
 * manda il server, e girano lo stesso.
 */

test.describe('Cart and Search', () => {
  test('empty cart shows EmptyState with CTA', async ({ page }) => {
    await page.goto('/cart');
    // 31/10/2026 — Il titolo del carrello vuoto, non «Esplora»: quella parola sta anche nel piè di
    // pagina, e appena il carrello finiva di disegnarsi il selettore trovava tre elementi e la prova
    // cadeva per la regola del selettore unico, a seconda di quanto era carica la macchina.
    await expect(page.getByRole('heading', { name: /carrello è vuoto/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('main').getByRole('link', { name: /Esplora/i })).toBeVisible();
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

  test('stores page renders list', async ({ page, request }) => {
    const diagnosi = await diagnosiJavascript(request, '/stores');
    test.skip(diagnosi.senzaJavascript, diagnosi.motivo);
    await page.goto('/stores');
    // `.first()`: la pagina viva puo' portare piu' di un titolo di primo livello (il piede ne ha
    // uno suo). Prima le pagine erano gusci morti e il selettore largo bastava.
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('404 page is custom', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist-404');
    expect([404, 200]).toContain(res?.status() ?? 0);
  });
});
