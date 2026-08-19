import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * 130 — IL CANCELLO CHE MANCAVA.
 *
 * La Dichiarazione di Accessibilità pubblica prometteva un audit periodico, e
 * nel progetto non c'era nessuna prova che potesse diventare rossa: né axe, né
 * pa11y, né la regola di lint per l'accessibilità. Tutto quello che è stato
 * riparato in questo lotto poteva tornare indietro alla prima modifica, senza
 * che nessuno se ne accorgesse.
 *
 * Questa prova percorre le cinque pagine con cui si compra e pretende zero
 * violazioni gravi. È la differenza fra «pensiamo di essere accessibili» e
 * «lo verifichiamo a ogni modifica».
 *
 * 148 — Sulla stessa passata si controlla che ci sia UN SOLO landmark <main>:
 * è il test che avrebbe intercettato i due <main> annidati di ricerca e
 * categoria, e che nel progetto non esisteva.
 */

const PAGINE = [
  { nome: 'home', url: '/' },
  { nome: 'ricerca', url: '/search?q=pane' },
  { nome: 'carrello', url: '/cart' },
  { nome: 'negozi', url: '/stores' },
];

for (const pagina of PAGINE) {
  test(`accessibilita: ${pagina.nome} senza violazioni gravi`, async ({ page }) => {
    await page.goto(pagina.url);
    await page.waitForLoadState('domcontentloaded');

    const esito = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const gravi = esito.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Il messaggio elenca cosa e dove: un rosso deve dire da solo cosa riparare.
    const dettaglio = gravi
      .map((v) => `${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`)
      .join('\n');
    expect(gravi, `Violazioni gravi su ${pagina.url}:\n${dettaglio}`).toEqual([]);
  });

  test(`accessibilita: ${pagina.nome} ha un solo landmark principale`, async ({ page }) => {
    await page.goto(pagina.url);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('main')).toHaveCount(1);
  });
}
