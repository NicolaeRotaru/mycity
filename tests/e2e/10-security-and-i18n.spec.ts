import { test, expect } from '@playwright/test';

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

  test('POST /api/locale con locale=en setta cookie e cambia lang', async ({ page, request }) => {
    await page.context().clearCookies();
    const r = await request.post('/api/locale', {
      data: { locale: 'en' },
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.locale).toBe('en');

    // Inietto il cookie nel context
    await page.context().addCookies([
      { name: 'NEXT_LOCALE', value: 'en', domain: 'localhost', path: '/' },
    ]);
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('POST /api/locale con locale invalido → 400', async ({ request }) => {
    const r = await request.post('/api/locale', {
      data: { locale: 'xx' },
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status()).toBe(400);
  });

  test('LocaleSwitcher è presente in Footer', async ({ page }) => {
    await page.goto('/');
    // Footer ha il toggle con icona Globe + label 'EN' (default it → next è en)
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const switcher = footer.locator('button[aria-label*="English"], button[aria-label*="italiano"]').first();
    await expect(switcher).toBeVisible();
  });

  test('Accept-Language header risolve a en se cookie missing', async ({ request }) => {
    // Cookie clearer + Accept-Language en
    const r = await request.get('/', {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toMatch(/<html[^>]+lang="en"/);
  });
});
