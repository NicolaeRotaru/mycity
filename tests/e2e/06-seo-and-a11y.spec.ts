import { test, expect } from '@playwright/test';

/**
 * SEO + accessibility smoke checks.
 * Verifica meta tags, structured data, alt text essenziali.
 */

test.describe('SEO and accessibility', () => {
  test('home has meta title and description', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MyCity/);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
    expect(description!.length).toBeGreaterThan(50);
  });

  /*
   * 3/9/2026 — LE DUE PROVE QUI SOTTO CERCAVANO UNA PAROLA, NON UN FATTO.
   *
   * Sono rimaste ferme mentre il sito cambiava, perche' il lavoro end-to-end in
   * CI si auto-saltava senza i segreti di un Supabase di prova. Riaccese,
   * erano rosse per due motivi che non sono difetti:
   *   - il dato strutturato della home dichiara `OnlineStore`, che in
   *     schema.org E' un'organizzazione (Organization → OnlineBusiness →
   *     OnlineStore); la prova cercava la stringa «Organization» e non la
   *     trovava piu';
   *   - robots.txt scrive «User-Agent» con la A maiuscola, e la prova cercava
   *     «User-agent». Il protocollo non distingue le maiuscole: la differenza
   *     esisteva solo dentro la prova.
   * Adesso chiedono la sostanza: un dato strutturato leggibile che dice chi
   * siamo, e un robots.txt che parla ai motori di ricerca.
   */
  test('home has Organization JSON-LD', async ({ page }) => {
    await page.goto('/');
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(jsonLd, 'la home non pubblica nessun dato strutturato').toBeTruthy();
    const dato = JSON.parse(jsonLd!) as { '@context'?: string; '@type'?: string; name?: string };
    expect(dato['@context']).toContain('schema.org');
    // I tipi di schema.org che discendono da Organization e che ha senso
    // dichiarare qui. Un `@type` fuori da questo elenco e' un cambio di
    // significato, non un ritocco: va guardato.
    expect(
      ['Organization', 'OnlineBusiness', 'OnlineStore', 'Store', 'LocalBusiness'],
      `la home si dichiara «${dato['@type']}», che non e' un'organizzazione`,
    ).toContain(dato['@type']);
    expect(dato.name).toBeTruthy();
  });

  test('robots.txt is served', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.status()).toBe(200);
    const text = await r.text();
    // Il protocollo non distingue maiuscole e minuscole, e nemmeno noi.
    expect(text).toMatch(/^\s*user-agent\s*:/im);
  });

  test('sitemap.xml is served and contains URLs', async ({ request }) => {
    const r = await request.get('/sitemap.xml');
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain('<urlset');
    expect(text).toContain('<loc>');
  });

  test('images on home have alt attributes', async ({ page }) => {
    await page.goto('/');
    const imagesWithoutAlt = await page.locator('img:not([alt])').count();
    expect(imagesWithoutAlt).toBe(0);
  });

  test('main landmark is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });
});
