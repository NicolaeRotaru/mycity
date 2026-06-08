import { describe, it, expect } from 'vitest';
import {
  storeSiteSchema,
  normalizeSite,
  defaultSite,
  defaultHomeSections,
  isDefaultSite,
  homePage,
  pageBySlug,
  pageById,
  enabledSections,
  resolveMenu,
  siteByteSize,
  newSection,
  newPage,
  newId,
  slugify,
  RESERVED_SLUGS,
  SECTION_TYPES,
  type StoreSite,
} from '@/lib/store-site';

/**
 * Unit test per lib/store-site: parsing difensivo + default home (retro-compat),
 * validazione slug/riservati/duplicati, ID video, menu risolto, helper puri.
 */

describe('normalizeSite / defaultSite', () => {
  it('returns the default site for {}/null/garbage', () => {
    expect(normalizeSite(null)).toEqual(defaultSite());
    expect(normalizeSite(undefined)).toEqual(defaultSite());
    expect(normalizeSite({})).toEqual(defaultSite());
    expect(normalizeSite(42)).toEqual(defaultSite());
    expect(normalizeSite('nope')).toEqual(defaultSite());
  });

  it('default home reproduces the current fixed layout order', () => {
    const home = homePage(defaultSite());
    expect(home.slug).toBe('');
    expect(home.sections.map((s) => s.type)).toEqual([
      'hero', 'contact', 'hours', 'reviews', 'featured', 'promotions', 'productGrid',
    ]);
    expect(home.sections.every((s) => s.enabled)).toBe(true);
  });

  it('isDefaultSite detects empty/absent site', () => {
    expect(isDefaultSite(null)).toBe(true);
    expect(isDefaultSite({})).toBe(true);
    expect(isDefaultSite(defaultSite())).toBe(false);
  });

  it('keeps a valid custom site', () => {
    const site: StoreSite = {
      theme: 'moderno',
      pages: [
        { id: 'home', slug: '', title: 'Home', visibility: 'public', seo: { noindex: false }, sections: defaultHomeSections() },
        { id: 'about', slug: 'chi-siamo', title: 'Chi siamo', visibility: 'public', seo: { noindex: false }, sections: [
          { id: 's1', type: 'richText', enabled: true, config: { heading: 'La nostra storia', body: 'Dal 1962.' } },
        ] },
      ],
      menu: { enabled: true, links: [{ id: 'l1', label: 'Chi siamo', target: { kind: 'page', pageId: 'about' } }] },
    };
    const out = normalizeSite(site);
    expect(out.pages).toHaveLength(2);
    expect(out.theme).toBe('moderno');
    expect(pageBySlug(out, 'chi-siamo')?.title).toBe('Chi siamo');
  });
});

describe('slug validation', () => {
  const homeOnly = (slug: string) => ({
    pages: [
      { id: 'home', slug: '', title: 'Home', sections: [] },
      { id: 'p2', slug, title: 'Pagina', sections: [] },
    ],
  });

  it('accepts kebab-case slugs', () => {
    expect(storeSiteSchema.safeParse(homeOnly('chi-siamo')).success).toBe(true);
  });

  it('rejects uppercase / spaces / bad chars', () => {
    expect(storeSiteSchema.safeParse(homeOnly('Chi Siamo')).success).toBe(false);
    expect(storeSiteSchema.safeParse(homeOnly('chi_siamo')).success).toBe(false);
    expect(storeSiteSchema.safeParse(homeOnly('-leading')).success).toBe(false);
  });

  it('rejects reserved slugs', () => {
    for (const r of ['opengraph-image', 'preview', 'sitemap', 'robots']) {
      expect(RESERVED_SLUGS.has(r)).toBe(true);
      expect(storeSiteSchema.safeParse(homeOnly(r)).success).toBe(false);
    }
  });

  it('rejects duplicate slugs', () => {
    const dup = {
      pages: [
        { id: 'home', slug: '', title: 'Home', sections: [] },
        { id: 'a', slug: 'offerte', title: 'A', sections: [] },
        { id: 'b', slug: 'offerte', title: 'B', sections: [] },
      ],
    };
    expect(storeSiteSchema.safeParse(dup).success).toBe(false);
  });
});

describe('video config', () => {
  const withVideo = (provider: string, videoId: string) => ({
    pages: [
      { id: 'home', slug: '', title: 'Home', sections: [
        { id: 'v', type: 'video', config: { provider, videoId } },
      ] },
    ],
  });

  it('accepts a valid youtube id (11 chars) and vimeo id (digits)', () => {
    expect(storeSiteSchema.safeParse(withVideo('youtube', 'dQw4w9WgXcQ')).success).toBe(true);
    expect(storeSiteSchema.safeParse(withVideo('vimeo', '123456789')).success).toBe(true);
  });

  it('accepts empty videoId (incomplete section)', () => {
    expect(storeSiteSchema.safeParse(withVideo('youtube', '')).success).toBe(true);
  });

  it('rejects malformed ids and embedded markup', () => {
    expect(storeSiteSchema.safeParse(withVideo('youtube', 'short')).success).toBe(false);
    expect(storeSiteSchema.safeParse(withVideo('youtube', '<iframe src=evil>')).success).toBe(false);
    expect(storeSiteSchema.safeParse(withVideo('vimeo', 'abcdef')).success).toBe(false);
  });
});

describe('banner / external url safety', () => {
  const withBanner = (url: string) => ({
    pages: [
      { id: 'home', slug: '', title: 'Home', sections: [
        { id: 'b', type: 'banner', config: { imageUrl: url } },
      ] },
    ],
  });

  it('accepts https image urls and empty', () => {
    expect(storeSiteSchema.safeParse(withBanner('https://cdn.example.com/x.jpg')).success).toBe(true);
    expect(storeSiteSchema.safeParse(withBanner('')).success).toBe(true);
  });

  it('rejects non-https (javascript:, http:)', () => {
    expect(storeSiteSchema.safeParse(withBanner('http://x.com/x.jpg')).success).toBe(false);
    expect(storeSiteSchema.safeParse(withBanner('javascript:alert(1)')).success).toBe(false);
  });
});

describe('limits', () => {
  it('rejects more than MAX_PAGES pages', () => {
    const pages = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`, slug: i === 0 ? '' : `p-${i}`, title: `P${i}`, sections: [],
    }));
    expect(storeSiteSchema.safeParse({ pages }).success).toBe(false);
  });

  it('rejects more than MAX_SECTIONS_PER_PAGE sections', () => {
    const sections = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, type: 'contact', config: {} }));
    expect(storeSiteSchema.safeParse({ pages: [{ id: 'home', slug: '', title: 'Home', sections }] }).success).toBe(false);
  });
});

describe('resolveMenu', () => {
  const site = normalizeSite({
    pages: [
      { id: 'home', slug: '', title: 'Home', sections: [] },
      { id: 'about', slug: 'chi-siamo', title: 'Chi siamo', visibility: 'public', sections: [] },
      { id: 'secret', slug: 'segreta', title: 'Segreta', visibility: 'hidden', sections: [] },
    ],
    menu: {
      enabled: true,
      links: [
        { id: 'l0', label: 'Home', target: { kind: 'home' } },
        { id: 'l1', label: 'Chi siamo', target: { kind: 'page', pageId: 'about' } },
        { id: 'l2', label: 'Segreta', target: { kind: 'page', pageId: 'secret' } },
        { id: 'l3', label: 'Blog', target: { kind: 'external', url: 'https://blog.example.com' } },
        { id: 'l4', label: 'Rotta', target: { kind: 'page', pageId: 'missing' } },
      ],
    },
  });

  it('builds hrefs, drops hidden/missing pages, marks external', () => {
    const links = resolveMenu(site, 'store-1');
    expect(links.map((l) => l.label)).toEqual(['Home', 'Chi siamo', 'Blog']);
    expect(links[0].href).toBe('/store/store-1');
    expect(links[1].href).toBe('/store/store-1/chi-siamo');
    expect(links[2]).toMatchObject({ href: 'https://blog.example.com', external: true, slug: null });
  });

  it('returns [] when menu disabled', () => {
    const off = normalizeSite({ pages: [{ id: 'home', slug: '', title: 'Home', sections: [] }], menu: { enabled: false, links: [] } });
    expect(resolveMenu(off, 'x')).toEqual([]);
  });
});

describe('helpers', () => {
  it('pageBySlug / pageById / homePage', () => {
    const site = normalizeSite({
      pages: [
        { id: 'home', slug: '', title: 'Home', sections: [] },
        { id: 'about', slug: 'chi-siamo', title: 'Chi siamo', sections: [] },
      ],
    });
    expect(homePage(site).id).toBe('home');
    expect(pageBySlug(site, '')?.id).toBe('home');
    expect(pageBySlug(site, 'chi-siamo')?.id).toBe('about');
    expect(pageBySlug(site, 'inesistente')).toBeUndefined();
    expect(pageById(site, 'about')?.slug).toBe('chi-siamo');
  });

  it('enabledSections filters disabled', () => {
    const page = { id: 'p', slug: '', title: 'P', visibility: 'public' as const, seo: { noindex: false }, sections: [
      { id: 'a', type: 'contact' as const, enabled: true, config: {} },
      { id: 'b', type: 'hours' as const, enabled: false, config: {} },
    ] };
    expect(enabledSections(page).map((s) => s.id)).toEqual(['a']);
    expect(enabledSections(undefined)).toEqual([]);
  });

  it('siteByteSize returns serialized length', () => {
    expect(siteByteSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it('newSection produces a schema-valid section for every type', () => {
    for (const type of SECTION_TYPES) {
      const s = newSection(type);
      expect(s.type).toBe(type);
      const wrapped = { pages: [{ id: 'home', slug: '', title: 'Home', sections: [s] }] };
      expect(storeSiteSchema.safeParse(wrapped).success).toBe(true);
    }
  });

  it('newId is non-empty and url-safe', () => {
    const id = newId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('slugify / newPage (multi-page)', () => {
  it('slugifies titles (accents, spaces, symbols)', () => {
    expect(slugify('Chi Siamo')).toBe('chi-siamo');
    expect(slugify('Offerte & Sconti!')).toBe('offerte-sconti');
    expect(slugify('Città di Còmo')).toBe('citta-di-como');
    expect(slugify('  ---weird---  ')).toBe('weird');
  });

  it('newPage derives a unique, non-reserved, valid slug', () => {
    const site = defaultSite();
    const p1 = newPage('Chi siamo', site);
    expect(p1.slug).toBe('chi-siamo');
    expect(p1.visibility).toBe('public');
    expect(p1.sections).toEqual([]);

    const site2 = { ...site, pages: [...site.pages, p1] };
    expect(newPage('Chi siamo', site2).slug).toBe('chi-siamo-2');

    expect(RESERVED_SLUGS.has(newPage('preview', site).slug)).toBe(false);
  });

  it('a site built with custom pages validates against the schema', () => {
    let site = defaultSite();
    site = { ...site, pages: [...site.pages, newPage('Chi siamo', site)] };
    site = { ...site, pages: [...site.pages, newPage('Contatti', site)] };
    expect(storeSiteSchema.safeParse(site).success).toBe(true);
    expect(pageBySlug(site, 'chi-siamo')).toBeDefined();
    expect(pageBySlug(site, 'contatti')).toBeDefined();
  });
});
