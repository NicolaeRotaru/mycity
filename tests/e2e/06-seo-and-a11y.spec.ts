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

  test('home has Organization JSON-LD', async ({ page }) => {
    await page.goto('/');
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(jsonLd).toContain('Organization');
  });

  test('robots.txt is served', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain('User-agent');
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
