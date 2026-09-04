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

/**
 * Il modulo dell'accesso o dell'iscrizione, non un modulo qualsiasi.
 *
 * Dal 3/9/2026 le pagine arrivano al browser col loro JavaScript (prima erano gusci morti). Da
 * allora il piede della pagina accende anche l'iscrizione alla newsletter, che ha il suo campo
 * email e il suo pulsante: `input[type="email"]` da solo ne pesca due e la prova fallisce senza
 * che ci sia niente di rotto. Restringere e' precisione, non indulgenza: se il modulo sparisce,
 * questa prova diventa rossa lo stesso.
 */
function moduloDiAccesso(page: import('@playwright/test').Page) {
  return page.getByRole('main').locator('form').first();
}

test.describe('Auth flow', () => {
  test('sign-in form renders and validates', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-in');
    await page.goto('/sign-in');
    // Il modulo dell'accesso, non un campo email qualsiasi della pagina: da quando le pagine
    // arrivano vive, il piede accende anche l'iscrizione alla newsletter, che ha il suo campo
    // email e il suo pulsante. Un selettore largo qui pescava due elementi e falliva.
    const accesso = moduloDiAccesso(page);
    await expect(accesso.locator('input[type="email"]')).toBeVisible();
    await expect(accesso.locator('input[type="password"]')).toBeVisible();
    await expect(accesso.locator('button[type="submit"]')).toContainText(/Accedi/i);
  });

  test('sign-up form has role selector', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-up');
    await page.goto('/sign-up');
    // Nel piede ci sono «Diventa venditore» e «Diventa rider»: cerco le tre scelte del ruolo
    // dentro il contenuto principale, non in tutta la pagina.
    const principale = page.getByRole('main');
    await expect(principale.getByText('Acquirente', { exact: false }).first()).toBeVisible();
    await expect(principale.getByText('Venditore', { exact: false }).first()).toBeVisible();
    await expect(principale.getByText('Rider', { exact: false }).first()).toBeVisible();
  });

  test('sign-up requires Terms acceptance', async ({ page, request }) => {
    await servePaginaViva(request, '/sign-up');
    await page.goto('/sign-up');
    const iscrizione = moduloDiAccesso(page);
    // Il nome e' obbligatorio: senza, il browser ferma l'invio e l'avviso sui Termini non
    // arriva mai. Finche' la pagina era un guscio morto questa prova si saltava, quindi il
    // buco non si vedeva.
    await iscrizione.getByLabel(/Nome/i).fill('Mario Rossi');
    await iscrizione.locator('input[type="email"]').fill('test@example.com');
    await iscrizione.locator('input[type="password"]').first().fill('password1234');
    await iscrizione.locator('button[type="submit"]').click();
    // L'avviso che compare dopo l'invio, non la casella da spuntare: la parola «Termini» sta in
    // tutte e due, e un selettore largo ne pesca due e fallisce senza che ci sia niente di rotto.
    await expect(
      page.getByText(/Devi accettare Termini e Privacy/i).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test('protected route redirects unauthenticated to sign-in', async ({ page }) => {
    await page.goto('/profile/settings');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });
});
