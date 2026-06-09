import { describe, it, expect } from 'vitest';
import {
  homeSiteSchema,
  normalizeHomeSite,
  defaultHomeSite,
  isDefaultHomeSite,
  homeEnabledSections,
  homeCtaHref,
  newHomeSection,
  siteByteSize,
  newId,
  HOME_SECTION_TYPES,
  type HomeSite,
} from '@/lib/home-site';

/**
 * Unit test per lib/home-site: parsing difensivo + home di default (retro-compat),
 * validazione blocchi (video/banner/link), limiti anti-abuso, helper puri.
 */

describe('normalizeHomeSite / defaultHomeSite', () => {
  it('returns the default home for {}/null/garbage', () => {
    expect(normalizeHomeSite(null)).toEqual(defaultHomeSite());
    expect(normalizeHomeSite(undefined)).toEqual(defaultHomeSite());
    expect(normalizeHomeSite({})).toEqual(defaultHomeSite());
    expect(normalizeHomeSite(42)).toEqual(defaultHomeSite());
    expect(normalizeHomeSite('nope')).toEqual(defaultHomeSite());
  });

  it('default home reproduces the current fixed layout order', () => {
    const site = defaultHomeSite();
    expect(site.sections.map((s) => s.type)).toEqual([
      'hero', 'howItWorks', 'categories', 'dropOfDay', 'popularProducts',
      'liveActivity', 'nearbyStores', 'newsletter', 'sellerCta',
    ]);
    expect(site.sections.every((s) => s.enabled)).toBe(true);
  });

  it('isDefaultHomeSite detects empty/absent config', () => {
    expect(isDefaultHomeSite(null)).toBe(true);
    expect(isDefaultHomeSite({})).toBe(true);
    expect(isDefaultHomeSite(defaultHomeSite())).toBe(false);
  });

  it('keeps a valid custom home', () => {
    const site: HomeSite = {
      version: 1,
      sections: [
        { id: 'hero', type: 'hero', enabled: true, config: { headline: 'Benvenuti' } },
        { id: 's1', type: 'richText', enabled: true, config: { heading: 'Promo', body: 'Sconti oggi.' } },
        { id: 's2', type: 'categories', enabled: false, config: {} },
      ],
    };
    const out = normalizeHomeSite(site);
    expect(out.sections).toHaveLength(3);
    expect(out.sections[0].type).toBe('hero');
  });
});

describe('video config', () => {
  const withVideo = (provider: string, videoId: string) => ({
    sections: [{ id: 'v', type: 'video', config: { provider, videoId } }],
  });

  it('accepts a valid youtube id (11 chars) and vimeo id (digits)', () => {
    expect(homeSiteSchema.safeParse(withVideo('youtube', 'dQw4w9WgXcQ')).success).toBe(true);
    expect(homeSiteSchema.safeParse(withVideo('vimeo', '123456789')).success).toBe(true);
  });

  it('accepts empty videoId (incomplete section)', () => {
    expect(homeSiteSchema.safeParse(withVideo('youtube', '')).success).toBe(true);
  });

  it('rejects malformed ids and embedded markup', () => {
    expect(homeSiteSchema.safeParse(withVideo('youtube', 'short')).success).toBe(false);
    expect(homeSiteSchema.safeParse(withVideo('youtube', '<iframe src=evil>')).success).toBe(false);
    expect(homeSiteSchema.safeParse(withVideo('vimeo', 'abcdef')).success).toBe(false);
  });
});

describe('banner / link safety', () => {
  const withBanner = (url: string) => ({
    sections: [{ id: 'b', type: 'banner', config: { imageUrl: url } }],
  });
  const withCta = (href: string) => ({
    sections: [{ id: 'b', type: 'banner', config: { imageUrl: 'https://cdn.example.com/x.jpg', cta: { label: 'Vai', href } } }],
  });

  it('accepts https image urls and empty', () => {
    expect(homeSiteSchema.safeParse(withBanner('https://cdn.example.com/x.jpg')).success).toBe(true);
    expect(homeSiteSchema.safeParse(withBanner('')).success).toBe(true);
  });

  it('rejects non-https images (javascript:, http:)', () => {
    expect(homeSiteSchema.safeParse(withBanner('http://x.com/x.jpg')).success).toBe(false);
    expect(homeSiteSchema.safeParse(withBanner('javascript:alert(1)')).success).toBe(false);
  });

  it('CTA href accepts internal paths, https and empty; rejects unsafe', () => {
    expect(homeSiteSchema.safeParse(withCta('/categorie')).success).toBe(true);
    expect(homeSiteSchema.safeParse(withCta('https://example.com')).success).toBe(true);
    expect(homeSiteSchema.safeParse(withCta('')).success).toBe(true);
    expect(homeSiteSchema.safeParse(withCta('javascript:alert(1)')).success).toBe(false);
    expect(homeSiteSchema.safeParse(withCta('http://x.com')).success).toBe(false);
  });
});

describe('limits', () => {
  it('rejects more than MAX_HOME_SECTIONS sections', () => {
    const sections = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, type: 'howItWorks', config: {} }));
    expect(homeSiteSchema.safeParse({ sections }).success).toBe(false);
  });

  it('clamps popularProducts limit to 4..24', () => {
    const mk = (limit: number) => ({ sections: [{ id: 'p', type: 'popularProducts', config: { limit } }] });
    expect(homeSiteSchema.safeParse(mk(12)).success).toBe(true);
    expect(homeSiteSchema.safeParse(mk(2)).success).toBe(false);
    expect(homeSiteSchema.safeParse(mk(99)).success).toBe(false);
  });
});

describe('helpers', () => {
  it('homeEnabledSections filters disabled', () => {
    const site: HomeSite = {
      version: 1,
      sections: [
        { id: 'a', type: 'howItWorks', enabled: true, config: {} },
        { id: 'b', type: 'categories', enabled: false, config: {} },
      ],
    };
    expect(homeEnabledSections(site).map((s) => s.id)).toEqual(['a']);
  });

  it('homeCtaHref returns href or null for empty', () => {
    expect(homeCtaHref('/categorie')).toBe('/categorie');
    expect(homeCtaHref('')).toBeNull();
    expect(homeCtaHref('   ')).toBeNull();
    expect(homeCtaHref(undefined)).toBeNull();
  });

  it('siteByteSize returns serialized length', () => {
    expect(siteByteSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it('newHomeSection produces a schema-valid section for every type', () => {
    for (const type of HOME_SECTION_TYPES) {
      const s = newHomeSection(type);
      expect(s.type).toBe(type);
      expect(homeSiteSchema.safeParse({ sections: [s] }).success).toBe(true);
    }
  });

  it('newId is non-empty and url-safe', () => {
    const id = newId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
