import { z } from 'zod';

/**
 * Sito vetrina multi-pagina — tipi, validazione (zod), cataloghi curati e helper puri.
 * Modulo "single source of truth" sul modello di lib/store-customization.ts e
 * lib/store-hours.ts.
 *
 * I dati vivono nella colonna JSONB profiles.store_site (migration 072). La validazione
 * (forma + limiti anti-abuso) è in app, non nel DB. La sanitizzazione del testo ricco e
 * la costruzione degli embed video NON avvengono qui: lo schema accetta/limita i valori,
 * ma l'HTML va sanitizzato a parte (lib/sanitize-html.ts) prima del salvataggio/render.
 *
 * Logica "Shopify": un negozio compone un SITO fatto di PAGINE; ogni pagina è una lista
 * ordinata di SEZIONI (strutturali = riusano i pezzi della vetrina attuale; contenuto =
 * blocchi liberi). Un MENU collega le pagine; un TEMA cambia il look. La HOME è pages[0]
 * con slug '' e si rende su /store/[id]; le pagine custom su /store/[id]/[slug].
 *
 * Retro-compatibilità: store_site assente/{} => `normalizeSite` ritorna `defaultSite()`,
 * una home che riproduce il layout fisso attuale (le sezioni strutturali leggono i dati
 * dove li legge oggi la pagina). Nessuna migrazione dati richiesta.
 */

/* ============================================================================
 * Limiti anti-abuso (esportati, come MAX_FEATURED ecc. di store-customization)
 * ========================================================================== */
export const MAX_PAGES = 8;
export const MAX_SECTIONS_PER_PAGE = 20;
export const MAX_MENU_LINKS = 8;
export const MAX_COLLECTION_PRODUCTS = 24;
export const MAX_GALLERY_ITEMS = 12;
export const MAX_FAQ_ITEMS = 20;
export const RICHTEXT_MAX = 4000;
export const MAX_SLUG = 40;
export const MAX_PAGE_TITLE = 60;
/** Guard sulla dimensione serializzata del sito (anti-abuso). Usata nella route API. */
export const MAX_SITE_BYTES = 65536;

/** Slug riservati per le pagine custom (collidono con file/route del framework). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'opengraph-image',
  'icon',
  'apple-icon',
  'favicon',
  'sitemap',
  'sitemap.xml',
  'robots',
  'robots.txt',
  'preview',
]);

/* ============================================================================
 * Cataloghi curati (tema + sezioni)
 * ========================================================================== */

export const THEME_KEYS = ['classico', 'moderno', 'editoriale', 'caldo'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const THEME_PRESETS: { key: ThemeKey; label: string; description: string }[] = [
  { key: 'classico',   label: 'Classico',   description: 'Caldo e tradizionale (default)' },
  { key: 'moderno',    label: 'Moderno',    description: 'Pulito, angoli netti, molto respiro' },
  { key: 'editoriale', label: 'Editoriale', description: 'Tipografia serif, da rivista' },
  { key: 'caldo',      label: 'Caldo',      description: 'Tinte crema, morbido' },
];

export const DEFAULT_THEME: ThemeKey = 'classico';

/** Tutti i tipi di sezione. Strutturali = riusano la vetrina attuale; contenuto = liberi. */
export const SECTION_TYPES = [
  'hero', 'contact', 'hours', 'reviews', 'featured', 'promotions', 'productGrid',
  'richText', 'banner', 'collection', 'gallery', 'video', 'faq',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_CATALOG: {
  type: SectionType; label: string; description: string; group: 'struttura' | 'contenuto';
}[] = [
  { type: 'hero',        label: 'Copertina',          description: 'Cover, logo, nome, badge e social', group: 'struttura' },
  { type: 'contact',     label: 'Contatti',           description: 'Telefono e indirizzo',              group: 'struttura' },
  { type: 'hours',       label: 'Orari',              description: 'Orari di apertura',                 group: 'struttura' },
  { type: 'reviews',     label: 'Recensioni',         description: 'Recensioni dei clienti',            group: 'struttura' },
  { type: 'featured',    label: 'In evidenza',        description: 'Prodotti in evidenza scelti',       group: 'struttura' },
  { type: 'promotions',  label: 'Promozioni',         description: 'Promozioni attive del negozio',     group: 'struttura' },
  { type: 'productGrid', label: 'Tutti i prodotti',   description: 'Griglia con ricerca e filtri',      group: 'struttura' },
  { type: 'richText',    label: 'Testo',              description: 'Titolo e testo formattato',         group: 'contenuto' },
  { type: 'banner',      label: 'Banner',             description: 'Immagine con titolo e pulsante',    group: 'contenuto' },
  { type: 'collection',  label: 'Collezione prodotti',description: 'Prodotti scelti o per categoria',   group: 'contenuto' },
  { type: 'gallery',     label: 'Galleria',           description: 'Galleria di immagini',              group: 'contenuto' },
  { type: 'video',       label: 'Video',              description: 'Video YouTube o Vimeo',             group: 'contenuto' },
  { type: 'faq',         label: 'FAQ',                description: 'Domande e risposte',                group: 'contenuto' },
];

export function sectionLabel(type: string): string {
  return SECTION_CATALOG.find((s) => s.type === type)?.label ?? type;
}
export function themeLabel(key: string): string {
  return THEME_PRESETS.find((t) => t.key === key)?.label ?? key;
}

/* ============================================================================
 * Schemi di validazione (zod)
 * ========================================================================== */

const idSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'ID non valido');

/** URL assoluto https (immagini storage, link esterni). http e altri schemi rifiutati. */
const httpsUrlSchema = z
  .string()
  .trim()
  .url('URL non valido')
  .max(500)
  .refine((v) => /^https:\/\//i.test(v), 'Deve iniziare con https://');

/** URL https oppure stringa vuota (campo immagine non ancora compilato nell'editor). */
const optionalHttpsUrl = z.union([z.literal(''), httpsUrlSchema]);

const shortText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Slug pagina: '' = home; altrimenti kebab-case, non riservato. */
const pageSlugSchema = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .max(MAX_SLUG)
    .regex(SLUG_RE, 'Solo lettere minuscole, numeri e trattini')
    .refine((s) => !RESERVED_SLUGS.has(s), 'Slug riservato dal sistema'),
]);

/* ---- Target di una CTA / link ---- */
const ctaTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category'), categorySlug: z.string().trim().min(1, 'Scegli una categoria').max(80) }),
  z.object({ kind: z.literal('product'), productId: z.string().uuid('Scegli un prodotto') }),
  z.object({ kind: z.literal('page'), pageId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('external'), url: httpsUrlSchema }),
]);
export type CTATarget = z.infer<typeof ctaTargetSchema>;

/* ---- Config per tipo di sezione ---- */
const emptyConfig = z.object({}).default({});

const heroConfig = z
  .object({
    showBadges: z.boolean().default(true),
    showSocials: z.boolean().default(true),
    showDescription: z.boolean().default(true),
  })
  .default({});

const richTextConfig = z.object({
  heading: shortText(120),
  // HTML vincolato; va sanitizzato prima di salvare/renderizzare (lib/sanitize-html.ts).
  body: z.string().max(RICHTEXT_MAX).default(''),
});

const bannerConfig = z.object({
  imageUrl: optionalHttpsUrl,
  heading: shortText(120),
  subheading: shortText(200),
  overlay: z.enum(['light', 'dark', 'none']).default('dark'),
  cta: z
    .object({ label: z.string().trim().min(1).max(40), target: ctaTargetSchema })
    .optional(),
});

const collectionSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('manual'),
    productIds: z.array(z.string().uuid()).max(MAX_COLLECTION_PRODUCTS).default([]),
  }),
  z.object({
    kind: z.literal('category'),
    categoryId: z.string().uuid('Scegli una categoria'),
    limit: z.number().int().min(4).max(MAX_COLLECTION_PRODUCTS).default(12),
  }),
]);

const collectionConfig = z.object({
  heading: shortText(120),
  source: collectionSourceSchema,
  layout: z.enum(['grid', 'carousel']).default('grid'),
});

const galleryConfig = z.object({
  heading: shortText(120),
  items: z
    .array(z.object({ url: httpsUrlSchema, alt: shortText(120) }))
    .max(MAX_GALLERY_ITEMS)
    .default([]),
});

const videoConfig = z
  .object({
    heading: shortText(120),
    provider: z.enum(['youtube', 'vimeo']).default('youtube'),
    // ID solo (mai HTML embed): vuoto ammesso (sezione non ancora compilata).
    videoId: z.string().trim().max(32).default(''),
  })
  .superRefine((v, ctx) => {
    if (!v.videoId) return; // vuoto = sezione incompleta, il render la salta
    const ok = v.provider === 'youtube'
      ? /^[A-Za-z0-9_-]{11}$/.test(v.videoId)
      : /^[0-9]{6,12}$/.test(v.videoId);
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ID video non valido', path: ['videoId'] });
  });

const faqConfig = z.object({
  heading: shortText(120),
  items: z
    .array(z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().min(1).max(1000) }))
    .max(MAX_FAQ_ITEMS)
    .default([]),
});

/** Costruttore di uno schema-sezione discriminato su `type`. */
function section<T extends SectionType, C extends z.ZodTypeAny>(type: T, config: C) {
  return z.object({
    id: idSchema,
    type: z.literal(type),
    enabled: z.boolean().default(true),
    config,
  });
}

const sectionSchema = z.discriminatedUnion('type', [
  section('hero', heroConfig),
  section('contact', emptyConfig),
  section('hours', emptyConfig),
  section('reviews', emptyConfig),
  section('featured', emptyConfig),
  section('promotions', emptyConfig),
  section('productGrid', emptyConfig),
  section('richText', richTextConfig),
  section('banner', bannerConfig),
  section('collection', collectionConfig),
  section('gallery', galleryConfig),
  section('video', videoConfig),
  section('faq', faqConfig),
]);
export type SiteSection = z.infer<typeof sectionSchema>;

const pageSchema = z.object({
  id: idSchema,
  slug: pageSlugSchema,
  title: z.string().trim().min(1).max(MAX_PAGE_TITLE),
  visibility: z.enum(['public', 'hidden']).default('public'),
  seo: z
    .object({
      title: shortText(70),
      description: shortText(180),
      noindex: z.boolean().default(false),
    })
    .default({}),
  sections: z.array(sectionSchema).max(MAX_SECTIONS_PER_PAGE).default([]),
});
export type SitePage = z.infer<typeof pageSchema>;

const menuLinkSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(30),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('home') }),
    z.object({ kind: z.literal('page'), pageId: z.string().min(1).max(64) }),
    z.object({ kind: z.literal('external'), url: httpsUrlSchema }),
  ]),
});
export type MenuLink = z.infer<typeof menuLinkSchema>;

export const storeSiteSchema = z
  .object({
    theme: z.enum(THEME_KEYS).default(DEFAULT_THEME),
    pages: z.array(pageSchema).min(1).max(MAX_PAGES),
    menu: z
      .object({
        enabled: z.boolean().default(false),
        links: z.array(menuLinkSchema).max(MAX_MENU_LINKS).default([]),
      })
      .default({ enabled: false, links: [] }),
  })
  .superRefine((site, ctx) => {
    // Slug unici (collisione = pagine irraggiungibili in routing).
    const seen = new Set<string>();
    site.pages.forEach((p, i) => {
      if (seen.has(p.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Slug duplicato: "${p.slug || 'home'}"`,
          path: ['pages', i, 'slug'],
        });
      }
      seen.add(p.slug);
    });
  });

export type StoreSite = z.infer<typeof storeSiteSchema>;

/* ============================================================================
 * Default + normalizzazione (retro-compatibilità)
 * ========================================================================== */

/** Le sezioni della home di default = layout fisso attuale, nello stesso ordine. */
export function defaultHomeSections(): SiteSection[] {
  return [
    { id: 'hero',        type: 'hero',        enabled: true, config: { showBadges: true, showSocials: true, showDescription: true } },
    { id: 'contact',     type: 'contact',     enabled: true, config: {} },
    { id: 'hours',       type: 'hours',       enabled: true, config: {} },
    { id: 'reviews',     type: 'reviews',     enabled: true, config: {} },
    { id: 'featured',    type: 'featured',    enabled: true, config: {} },
    { id: 'promotions',  type: 'promotions',  enabled: true, config: {} },
    { id: 'productGrid', type: 'productGrid', enabled: true, config: {} },
  ];
}

/** Sito di default: una sola pagina home che riproduce la vetrina attuale. */
export function defaultSite(): StoreSite {
  return {
    theme: DEFAULT_THEME,
    pages: [
      {
        id: 'home',
        slug: '',
        title: 'Home',
        visibility: 'public',
        seo: { noindex: false },
        sections: defaultHomeSections(),
      },
    ],
    menu: { enabled: false, links: [] },
  };
}

/** Normalizza un valore qualsiasi (incl. JSONB dal DB) a uno StoreSite renderizzabile. */
export function normalizeSite(raw: unknown): StoreSite {
  if (raw && typeof raw === 'object' && Object.keys(raw as object).length > 0) {
    const parsed = storeSiteSchema.safeParse(raw);
    if (parsed.success && parsed.data.pages.length > 0) return parsed.data;
  }
  return defaultSite();
}

/** Vero se il sito è "vuoto" (nessuna personalizzazione salvata): render = default. */
export function isDefaultSite(raw: unknown): boolean {
  return !raw || typeof raw !== 'object' || Object.keys(raw as object).length === 0;
}

/* ============================================================================
 * Helper puri (unit-testabili)
 * ========================================================================== */

export function homePage(site: StoreSite): SitePage {
  return site.pages.find((p) => p.slug === '') ?? site.pages[0];
}

export function pageBySlug(site: StoreSite, slug: string): SitePage | undefined {
  if (slug === '') return homePage(site);
  return site.pages.find((p) => p.slug === slug);
}

export function pageById(site: StoreSite, id: string): SitePage | undefined {
  return site.pages.find((p) => p.id === id);
}

/** Sezioni effettivamente da renderizzare (solo quelle attive). */
export function enabledSections(page: SitePage | undefined): SiteSection[] {
  return (page?.sections ?? []).filter((s) => s.enabled);
}

export type ResolvedMenuLink = {
  id: string;
  label: string;
  href: string;
  external: boolean;
  /** slug della pagina interna ('' = home), null per link esterni. Per evidenziare l'attivo. */
  slug: string | null;
};

/** Costruisce i link del menu risolti e validati (scarta pagine assenti/nascoste). */
export function resolveMenu(site: StoreSite, storeId: string): ResolvedMenuLink[] {
  if (!site.menu.enabled) return [];
  const base = `/store/${storeId}`;
  const out: ResolvedMenuLink[] = [];
  for (const l of site.menu.links) {
    if (l.target.kind === 'home') {
      out.push({ id: l.id, label: l.label, href: base, external: false, slug: '' });
    } else if (l.target.kind === 'page') {
      const p = pageById(site, l.target.pageId);
      if (p && p.visibility === 'public') {
        out.push({
          id: l.id,
          label: l.label,
          href: p.slug === '' ? base : `${base}/${p.slug}`,
          external: false,
          slug: p.slug,
        });
      }
    } else {
      out.push({ id: l.id, label: l.label, href: l.target.url, external: true, slug: null });
    }
  }
  return out;
}

/** href risolto di una CTA (banner). null se la pagina target non esiste. */
export function ctaHref(target: CTATarget, storeId: string, site: StoreSite): string | null {
  switch (target.kind) {
    case 'external':
      return target.url;
    case 'product':
      return `/product/${target.productId}`;
    case 'category':
      return `/category/${target.categorySlug}`;
    case 'page': {
      const p = pageById(site, target.pageId);
      if (!p) return null;
      return p.slug === '' ? `/store/${storeId}` : `/store/${storeId}/${p.slug}`;
    }
    default:
      return null;
  }
}

/** Dimensione serializzata del sito (per il guard anti-abuso). */
export function siteByteSize(site: unknown): number {
  try {
    return JSON.stringify(site).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** ID breve sicuro per chiavi React / id di pagine e sezioni (editor). */
export function newId(): string {
  const raw =
    (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function')
      ? globalThis.crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, '');
}

/** Crea una nuova sezione del tipo dato con config di default sensata (editor). */
export function newSection(type: SectionType): SiteSection {
  const id = newId();
  switch (type) {
    case 'hero':
      return { id, type, enabled: true, config: { showBadges: true, showSocials: true, showDescription: true } };
    case 'richText':
      return { id, type, enabled: true, config: { heading: '', body: '' } };
    case 'banner':
      return { id, type, enabled: true, config: { imageUrl: '', heading: '', subheading: '', overlay: 'dark' } };
    case 'collection':
      return { id, type, enabled: true, config: { heading: '', source: { kind: 'manual', productIds: [] }, layout: 'grid' } };
    case 'gallery':
      return { id, type, enabled: true, config: { heading: '', items: [] } };
    case 'video':
      return { id, type, enabled: true, config: { heading: '', provider: 'youtube', videoId: '' } };
    case 'faq':
      return { id, type, enabled: true, config: { heading: '', items: [] } };
    default:
      // strutturali senza config (contact/hours/reviews/featured/promotions/productGrid)
      return { id, type, enabled: true, config: {} } as SiteSection;
  }
}
