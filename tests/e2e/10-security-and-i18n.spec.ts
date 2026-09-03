import { test, expect } from '@playwright/test';
import { RILEVAMENTO_LINGUA_ATTIVO } from '../../i18n';

/**
 * E2E test per le feature security + i18n aggiunte in wave 21:
 *  - CSP nonce-per-request (header + nonce attributi nel HTML)
 *  - Locale switcher (POST /api/locale + cookie + html lang)
 *  - Security headers statici (X-Frame-Options, HSTS, ecc)
 */

test.describe('CSP nonce migration', () => {
  test('homepage ha header Content-Security-Policy', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const csp = response!.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain('script-src');
    expect(csp).toContain('default-src');
  });

  test('CSP include nonce in script-src (in prod) o unsafe-inline (in dev)', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response!.headers()['content-security-policy'];
    // In prod: nonce-XYZ + strict-dynamic. In dev: unsafe-eval + unsafe-inline.
    const hasNonce = /script-src[^;]*'nonce-[^']+'/.test(csp);
    const hasUnsafeInline = /script-src[^;]*'unsafe-inline'/.test(csp);
    expect(hasNonce || hasUnsafeInline).toBe(true);
  });

  test('frame-ancestors none — protezione clickjacking', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response!.headers()['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('header statici di security presenti', async ({ page }) => {
    const response = await page.goto('/');
    const h = response!.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('CSP nonce per ogni request è diverso (in prod)', async ({ page }) => {
    const r1 = await page.goto('/');
    const csp1 = r1!.headers()['content-security-policy'];
    const r2 = await page.goto('/sign-in');
    const csp2 = r2!.headers()['content-security-policy'];
    const m1 = csp1.match(/'nonce-([^']+)'/);
    const m2 = csp2.match(/'nonce-([^']+)'/);
    // In prod: nonce diversi. In dev: niente nonce.
    if (m1 && m2) {
      expect(m1[1]).not.toBe(m2[1]);
    }
  });
});

test.describe('Locale switching i18n', () => {
  test('default locale è italiano', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('it');
  });

  /*
   * 3/9/2026 — LA TERZA PROVA DELLA STESSA COPPIA, RIMASTA INDIETRO.
   *
   * Il commento qui sotto (#7) spiega che il rilevamento della lingua e'
   * SPENTO apposta — `RILEVAMENTO_LINGUA_ATTIVO = false` in i18n.ts — finche'
   * la traduzione non e' completa, e per questo la prova gemella sul selettore
   * nel piede e' saltata. Questa pero' non era stata toccata: pretendeva che
   * il biscotto `NEXT_LOCALE=en` cambiasse la lingua del documento, cioe' il
   * contrario della scelta presa. Restava rossa in silenzio perche' il lavoro
   * end-to-end in CI si auto-saltava.
   *
   * Non si salta: si gira, e si chiede cio' che la scelta promette davvero —
   * la rotta accetta la lingua e la ricorda, e la pagina resta italiana finche'
   * l'interruttore e' giu'. Cosi' la prova protegge la decisione invece di
   * combatterla, e il giorno che si riaccende diventa rossa e va riscritta
   * insieme al resto.
   */
  test('POST /api/locale con locale=en setta cookie ma la pagina resta italiana', async ({
    page,
    request,
  }) => {
    await page.context().clearCookies();
    const r = await request.post('/api/locale', {
      data: { locale: 'en' },
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.locale).toBe('en');
    // La rotta deve davvero posare il biscotto: e' la meta' che funziona.
    expect(String(r.headers()['set-cookie'] ?? '')).toContain('NEXT_LOCALE=en');

    // Inietto il cookie nel context
    await page.context().addCookies([
      { name: 'NEXT_LOCALE', value: 'en', domain: 'localhost', path: '/' },
    ]);
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(
      lang,
      'la pagina si e\' dichiarata inglese: o il rilevamento e\' stato riacceso (e allora questa prova va riscritta), o il contenuto italiano viene letto con la fonetica sbagliata',
    ).toBe('it');
  });

  test('POST /api/locale con locale invalido → 400', async ({ request }) => {
    const r = await request.post('/api/locale', {
      data: { locale: 'xx' },
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status()).toBe(400);
  });

  /*
   * #7 — La scelta: il selettore di lingua è tolto dal footer finché la
   * traduzione non è completa (29 file su 347), e la pagina si dichiara
   * italiana perché il contenuto è italiano. Si riaccendono insieme, cambiando
   * RILEVAMENTO_LINGUA_ATTIVO in i18n.ts.
   *
   * 3/9/2026 — QUESTO SALTO NON DICEVA PERCHE', E ADESSO LO DICE.
   *
   * Era un `test.skip(...)` secco: il motivo stava solo nel commento, che la CI
   * non legge. Nel resoconto delle prove usciva come «saltata senza motivo
   * dichiarato» — cioe' indistinguibile da un interruttore abbassato e
   * dimenticato, che e' la malattia di questo lotto.
   *
   * Adesso il salto e' appeso alla decisione vera, letta da i18n.ts: il giorno
   * che il rilevamento della lingua si riaccende, questa prova riparte da sola.
   */
  test('LocaleSwitcher è presente in Footer', async ({ page }) => {
    test.skip(
      !RILEVAMENTO_LINGUA_ATTIVO,
      'il selettore della lingua e\' tolto dal piede finche\' la traduzione non e\' completa (RILEVAMENTO_LINGUA_ATTIVO = false in i18n.ts): una lingua che si puo\' scegliere e non cambia niente e\' peggio di una lingua sola',
    );
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const switcher = footer.locator('button[aria-label*="English"], button[aria-label*="italiano"]').first();
    await expect(switcher).toBeVisible();
  });

  test('la pagina si dichiara italiana anche a un browser inglese', async ({ request }) => {
    // Il contenuto è italiano al 92%: marcarla `lang="en"` faceva provare ai
    // lettori per non vedenti a pronunciare l'italiano con la fonetica
    // inglese, e a Google indicizzare come inglese una pagina italiana.
    const r = await request.get('/', {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toMatch(/<html[^>]+lang="it"/);
  });
});
