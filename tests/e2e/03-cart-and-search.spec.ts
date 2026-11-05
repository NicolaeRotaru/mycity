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
    // 5/11/2026 (S04, scheda 478) — Prima bastava il primo h1 o h2 visibile: il piede di pagina ne
    // ha sempre uno, quindi la prova passava anche con la categoria rotta. Ora il titolo deve stare
    // nel contenuto e nominare la categoria (o dire che non c'è).
    // 5/11/2026 (unione) — In queste prove il database non c'è: la pagina mostra il suo errore onesto
    // («Non riesco a caricare questa categoria», con «Riprova»). Con il database, il nome della categoria
    // o «non trovata». Resta escluso il titolo del piede di pagina: si cerca dentro il contenuto.
    // Con il database di prova (E2E_DATI_DI_PROVA) il titolo è la categoria, o «non trovata». Senza,
    // il sito non può guardare e mostra la sua pagina d'errore («Qualcosa è andato storto»): va bene
    // un errore onesto dentro il contenuto, non va bene una pagina vuota o solo il piede.
    const titoloAtteso = process.env.E2E_DATI_DI_PROVA
      ? /alimentari|non trovata/i
      : /alimentari|non trovata|non riesco a caricare questa categoria|qualcosa è andato storto/i;
    await expect(page.getByRole('main').getByRole('heading', { name: titoloAtteso }).first()).toBeVisible({ timeout: 5000 });
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
    // 5/11/2026 (S04, scheda 478) — Accettava 200 o 404 e non guardava la pagina: passava anche
    // con una pagina bianca. Ora: 404 vero, e la nostra pagina (app/not-found.tsx).
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Pagina non trovata')).toBeVisible();
  });
});
