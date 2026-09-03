import { test, expect } from '@playwright/test';
import { diagnosiJavascript } from './_pagina-senza-javascript';

/**
 * Signup buyer end-to-end.
 *
 * Note: skippa in CI se ANTHROPIC_API_KEY / SUPABASE non sono in env.
 * In ambiente locale serve un Supabase project test.
 *
 * 3/9/2026 — Tre di queste quattro prove chiedono cose che esistono solo dopo
 * che la pagina si e' animata: le tre carte del ruolo, il salto all'accesso, il
 * codice invito letto dall'indirizzo. Oggi /sign-up arriva al browser senza
 * JavaScript (vedi `_pagina-senza-javascript.ts`), quindi si saltano — a
 * condizione, e la condizione e' il difetto stesso: riparato quello, tornano a
 * girare da sole. La prima prova invece non ha bisogno di niente: la verifica
 * del campo obbligatorio la fa il browser da solo.
 */

/** Salta finche' la pagina dell'iscrizione arriva senza il suo JavaScript. */
async function servePaginaViva(request: Parameters<typeof diagnosiJavascript>[0]) {
  const diagnosi = await diagnosiJavascript(request, '/sign-up');
  test.skip(diagnosi.senzaJavascript, diagnosi.motivo);
}

/**
 * Il modulo dell'iscrizione, non un modulo qualsiasi della pagina.
 *
 * Dal 3/9/2026 le pagine arrivano vive al browser: il piede accende l'iscrizione alla newsletter,
 * che ha anche lei un campo email e un pulsante. Un selettore largo ne pesca due e la prova
 * fallisce senza che ci sia niente di rotto.
 */
function moduloIscrizione(page: import('@playwright/test').Page) {
  return page.getByRole('main').locator('form').first();
}

test.describe('Signup flow', () => {
  test('form validates required fields', async ({ page }) => {
    await page.goto('/sign-up');
    const modulo = moduloIscrizione(page);
    // Submit vuoto
    await modulo.locator('button[type="submit"]').click();
    // HTML5 validation kicks in (email required)
    const email = modulo.locator('input[type="email"]');
    const isInvalid = await email.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('role selector works', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up');
    // 3 role cards visible
    // Nel piede ci sono «Diventa venditore» e «Diventa rider»: le tre scelte del ruolo si cercano
    // dentro il contenuto principale.
    const principale = page.getByRole('main');
    await expect(principale.getByText('Acquirente', { exact: false }).first()).toBeVisible();
    await expect(principale.getByText('Venditore', { exact: false }).first()).toBeVisible();
    await expect(principale.getByText('Rider', { exact: false }).first()).toBeVisible();
  });

  test('navigates to sign-in from sign-up', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up');
    // Il collegamento «Accedi», non «Accedi con codice via SMS»: da quando la pagina e' viva ci
    // sono tutti e due, e il primo che capita apre il pannello del codice invece di cambiare pagina.
    await page.getByRole('link', { name: /^Accedi$/ }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('referral code from URL applied', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up?ref=TEST123');
    await expect(page.getByRole('main').getByText('TEST123').first()).toBeVisible({ timeout: 3000 });
  });
});
