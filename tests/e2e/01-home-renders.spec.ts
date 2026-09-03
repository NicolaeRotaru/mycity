import { test, expect } from '@playwright/test';
import { CONSENT_STORAGE, CONSENT_VERSION } from '../../lib/consent';

/**
 * Prova di fumo: la home si apre e le sue parti vive funzionano.
 *
 * 3/9/2026 — QUATTRO PROVE ROSSE, E NESSUNA ERA UN DIFETTO DELLA HOME.
 *
 * Queste quattro prove non giravano in CI da mesi: il lavoro end-to-end si
 * auto-saltava quando mancavano i segreti di un Supabase di prova, che non sono
 * mai esistiti. Nel frattempo la home e' cambiata e le prove sono rimaste
 * ferme a com'era prima. Accese di nuovo, dicevano tutte e quattro la stessa
 * cosa: «non ti riconosco piu'», non «sei rotta».
 *
 *   1) il titolo era «Compra dai negozi», oggi e' «Ordini dai negozi di
 *      Piacenza. Paghi come vuoi.»;
 *   2) il pulsante «Inizia a esplorare» porta a /categorie, non a /search;
 *   3) il primo Tab non finisce sul salto al contenuto perche' l'avviso dei
 *      cookie prende il fuoco: e' giusto che lo prenda, ed e' la prova a
 *      chiedere la cosa sbagliata (vedi sotto);
 *   4) `text=cookie` combaciava con quattro elementi della pagina, quindi
 *      Playwright si fermava per ambiguita' invece di guardare l'avviso.
 *
 * Le prove sono state riportate su cio' che deve restare vero anche quando il
 * testo di vendita cambia: la home dice di che citta' parla, il pulsante porta
 * a una pagina dove si guardano i prodotti, il salto al contenuto e' il primo
 * elemento raggiungibile da tastiera, e chi arriva la prima volta vede l'avviso
 * dei cookie.
 */

/**
 * Il consenso ai cookie gia' dato, come lo trova chi torna una seconda volta.
 * Il momento si scrive dentro il browser: un consenso piu' vecchio di sei mesi
 * l'avviso lo richiede, quindi una data fissa scritta qui scadrebbe da sola e
 * la prova tornerebbe rossa senza che nessuno abbia toccato niente.
 */
const CONSENSO_GIA_DATO = {
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
  version: CONSENT_VERSION,
};

test.describe('Home page', () => {
  test('renders hero + CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MyCity/);
    // Il titolo dice di quale citta' si parla. Il resto della frase e' testo di
    // vendita e cambia: legarci una prova significa riscriverla a ogni giro.
    await expect(page.locator('h1')).toContainText(/Piacenza/i);
    await expect(page.locator('text=Inizia a esplorare')).toBeVisible();
  });

  test('navigates to search', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Inizia a esplorare');
    // 3/9/2026 — il pulsante porta a /categorie da quando la home apre sulle
    // categorie invece che sulla ricerca vuota. Quello che deve restare vero e'
    // che porti via dalla home, su una pagina dove si guardano i prodotti.
    await expect(page).toHaveURL(/\/(categorie|search)/);
  });

  test('skip link is keyboard-accessible', async ({ page, context }) => {
    // 3/9/2026 — QUI LA PROVA CHIEDEVA DUE COSE INSIEME E NE OTTENEVA UNA.
    //
    // Il primo Tab su una visita nuova finisce dentro l'avviso dei cookie, che
    // e' un `role="dialog"` e prende il fuoco: e' il comportamento giusto, un
    // avviso che chiede una scelta deve ricevere la tastiera. La prova pero'
    // pretendeva il salto al contenuto e diventava rossa su una cosa corretta.
    //
    // Il salto al contenuto si prova dove serve davvero: sulla pagina di chi ha
    // gia' risposto all'avviso, cioe' ogni visita dopo la prima.
    await context.addInitScript(
      ([chiave, consenso]) => {
        window.localStorage.setItem(
          chiave as string,
          JSON.stringify({ ...(consenso as Record<string, unknown>), ts: Date.now() }),
        );
      },
      [CONSENT_STORAGE, CONSENSO_GIA_DATO] as const,
    );
    await page.goto('/');
    const skipLink = page.locator('a:has-text("Vai al contenuto")');
    await expect(skipLink).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    // E porta davvero da qualche parte: un salto al contenuto che punta a un
    // ancoraggio inesistente e' un salto nel vuoto.
    const bersaglio = await skipLink.getAttribute('href');
    expect(bersaglio).toMatch(/^#.+/);
    await expect(page.locator(bersaglio!)).toHaveCount(1);
  });

  test('cookie banner is shown on first visit', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');
    // `text=cookie` combaciava con quattro elementi (l'avviso, il link
    // all'informativa nel piede, ...) e Playwright si fermava per ambiguita'.
    // L'avviso e' un solo elemento e ha un ruolo: si guarda quello.
    const avviso = page.getByRole('dialog').filter({ hasText: /cookie/i });
    await expect(avviso).toBeVisible({ timeout: 5000 });
    // Le due scelte devono avere lo stesso peso: e' la regola scritta in
    // components/CookieBanner.tsx, ed e' cio' che rende il consenso valido.
    await expect(avviso.getByRole('button', { name: /Accetta tutto/i })).toBeVisible();
    await expect(avviso.getByRole('button', { name: /Rifiuta tutto/i })).toBeVisible();
  });
});
