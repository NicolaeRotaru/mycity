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

  test('role selector works', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up');
    // 3 role cards visible
    await expect(page.locator('text=Acquirente')).toBeVisible();
    await expect(page.locator('text=Venditore')).toBeVisible();
    await expect(page.locator('text=Rider')).toBeVisible();
  });

  test('navigates to sign-in from sign-up', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up');
    await page.click('text=Accedi');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('referral code from URL applied', async ({ page, request }) => {
    await servePaginaViva(request);
    await page.goto('/sign-up?ref=TEST123');
    await expect(page.locator('text=TEST123')).toBeVisible({ timeout: 3000 });
  });
});
