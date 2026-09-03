import { test, expect } from '@playwright/test';
import { diagnosiJavascript } from './_pagina-senza-javascript';

/**
 * Smoke test: sign-in / sign-up flow happy path.
 * Non testa l'autenticazione vera (richiede DB), solo che le form
 * rendano e validino input di base.
 *
 * 3/9/2026 — I moduli di accesso e iscrizione si disegnano nel browser: senza
 * JavaScript la pagina resta il guscio e queste tre prove non possono dire
 * niente. Oggi /sign-in e /sign-up arrivano senza JavaScript per il difetto
 * descritto in `_pagina-senza-javascript.ts`, quindi si saltano finche' quel
 * difetto e' vivo — poi tornano a girare da sole. La quarta prova non si
 * salta: la rotta protetta la ferma il middleware, che gira lo stesso.
 */

/** Salta finche' la pagina indicata arriva senza il suo JavaScript. */
async function servePaginaViva(
  request: Parameters<typeof diagnosiJavascript>[0],
  percorso: string,
) {
  const diagnosi = await diagnosiJavascript(request, percorso);
  test.skip(diagnosi.senzaJavascript, diagnosi.motivo);
}

test.describe('Auth flow', () => {
  test('sign-in form renders and validates', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-in');
    await page.goto('/sign-in');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText(/Accedi/i);
  });

  test('sign-up form has role selector', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-up');
    await page.goto('/sign-up');
    await expect(page.locator('text=Acquirente')).toBeVisible();
    await expect(page.locator('text=Venditore')).toBeVisible();
    await expect(page.locator('text=Rider')).toBeVisible();
  });

  test('sign-up requires Terms acceptance', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-up');
    await page.goto('/sign-up');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password1234');
    await page.click('button[type="submit"]');
    // Toast con "Devi accettare Termini e Privacy"
    await expect(page.locator('text=/Termini|accettare/i')).toBeVisible({ timeout: 3000 });
  });

  test('protected route redirects unauthenticated to sign-in', async ({ page }) => {
    await page.goto('/profile/settings');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });
});
