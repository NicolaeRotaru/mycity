import { z } from 'zod';
import { newId, siteByteSize, MAX_SITE_BYTES } from './store-site';

/**
 * Home del marketplace componibile a blocchi — tipi, validazione (zod), catalogo
 * curato e helper puri. Modulo "single source of truth" sul modello di
 * lib/store-site.ts, ma a livello di PIATTAFORMA (una sola home globale) invece che
 * per singolo negozio.
 *
 * I dati vivono nella colonna JSONB site_settings.home_site (migration 075, riga
 * singleton id=1). La validazione (forma + limiti anti-abuso) è in app; la
 * sanitizzazione dell'HTML ricco avviene a parte (lib/sanitize-html.ts) prima del
 * salvataggio nell'API admin.
 *
 * Logica "Shopify": l'admin compone la HOME come lista ordinata di SEZIONI. Le sezioni
 * STRUTTURALI riusano i blocchi attuali della home (hero, categorie, prodotti, ecc.);
 * le sezioni CONTENUTO sono blocchi liberi (testo, banner, galleria, video).
 *
 * Retro-compatibilità: home_site assente/{} => `normalizeHomeSite` ritorna
 * `defaultHomeSite()`, che riproduce ESATTAMENTE l'ordine fisso attuale di app/page.tsx
 * (i testi di default vivono nel renderer come fallback). Nessuna migrazione dati.
 */

/* Riusa le primitive condivise con store-site (no duplicazione). */
export { newId, siteByteSize, MAX_SITE_BYTES };

/* ============================================================================
 * Limiti anti-abuso
 * ========================================================================== */
export const MAX_HOME_SECTIONS = 24;
export const MAX_GALLERY_ITEMS = 12;
export const RICHTEXT_MAX = 4000;
export const PRODUCTS_MIN = 4;
export const PRODUCTS_MAX = 24;

/* ============================================================================
 * Catalogo curato delle sezioni
 * ========================================================================== */

export const HOME_SECTION_TYPES = [
  // strutturali "core" (compongono la home di default)
  'hero', 'howItWorks', 'categories', 'dropOfDay', 'popularProducts',
  'liveActivity', 'nearbyStores', 'reorder', 'trustRow', 'newsletter', 'sellerCta',
  // strutturali "editoriali" (componenti pronti, non attivi di default)
  'shopOfMonth', 'stories', 'events', 'promo', 'trending',
  // contenuto (blocchi liberi)
  'richText', 'banner', 'gallery', 'video',
] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

export const HOME_SECTION_CATALOG: {
  type: HomeSectionType; label: string; description: string; group: 'struttura' | 'contenuto';
}[] = [
  { type: 'hero',            label: 'Hero',                description: 'Titolo, claim e negozio in evidenza',     group: 'struttura' },
  { type: 'howItWorks',      label: 'Come funziona',       description: 'I 3 passi (scegli → ordina → ricevi)',    group: 'struttura' },
  { type: 'categories',      label: 'Categorie',           description: 'Griglia delle categorie del mercato',     group: 'struttura' },
  { type: 'dropOfDay',       label: 'Drop del giorno',     description: "L'offerta del giorno (si auto-nasconde)", group: 'struttura' },
  { type: 'popularProducts', label: 'Prodotti popolari',   description: 'Griglia dei prodotti più amati',          group: 'struttura' },
  { type: 'liveActivity',    label: 'Attività live + Trust', description: 'Feed ordini in tempo reale + perché MyCity', group: 'struttura' },
  { type: 'nearbyStores',    label: 'Negozi vicini',       description: 'Vetrina dei negozi di Piacenza',          group: 'struttura' },
  { type: 'reorder',         label: 'Ordina di nuovo',     description: 'Riordino rapido dai tuoi ordini recenti (si auto-nasconde)', group: 'struttura' },
  { type: 'trustRow',        label: 'Banda fiducia',       description: 'Striscia a 4 colonne con le garanzie',    group: 'struttura' },
  { type: 'newsletter',      label: 'Newsletter',          description: 'Iscrizione newsletter con incentivo',     group: 'struttura' },
  { type: 'sellerCta',       label: 'CTA venditore',       description: 'Banda "Diventa venditore"',               group: 'struttura' },
  { type: 'shopOfMonth',     label: 'Negozio del mese',    description: 'Il negozio del mese scelto dall\'admin',  group: 'struttura' },
  { type: 'stories',         label: 'Storie',              description: 'Carosello storie dei negozi',             group: 'struttura' },
  { type: 'events',          label: 'Eventi',              description: 'Eventi del marketplace',                  group: 'struttura' },
  { type: 'promo',           label: 'Promozioni',          description: 'Offerte e promo attive',                  group: 'struttura' },
  { type: 'trending',        label: 'Di tendenza',         description: 'Prodotti di tendenza ora',                group: 'struttura' },
  { type: 'richText',        label: 'Testo',               description: 'Titolo e testo formattato',               group: 'contenuto' },
  { type: 'banner',          label: 'Banner',              description: 'Immagine con titolo e pulsante',          group: 'contenuto' },
  { type: 'gallery',         label: 'Galleria',            description: 'Galleria di immagini',                    group: 'contenuto' },
  { type: 'video',           label: 'Video',               description: 'Video YouTube, Vimeo o file MP4',         group: 'contenuto' },
];

export function homeSectionLabel(type: string): string {
  return HOME_SECTION_CATALOG.find((s) => s.type === type)?.label ?? type;
}

/* ============================================================================
 * Schemi di validazione (zod)
 * ========================================================================== */

const idSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'ID non valido');

const httpsUrlSchema = z
  .string()
  .trim()
  .url('URL non valido')
  .max(500)
  .refine((v) => /^https:\/\//i.test(v), 'Deve iniziare con https://');
const optionalHttpsUrl = z.union([z.literal(''), httpsUrlSchema]);

/** href di una CTA: vuoto, URL https assoluto, oppure percorso interno (/...). */
const linkHrefSchema = z.union([
  z.literal(''),
  httpsUrlSchema,
  z.string().trim().regex(/^\/[A-Za-z0-9/_-]*$/, 'Percorso interno non valido (es. /categorie)').max(200),
]);

const shortText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

/* ---- Config per tipo di sezione ---- */
const emptyConfig = z.object({}).default({});
const headingConfig = z.object({ heading: shortText(120) }).default({});

const heroConfig = z
  .object({
    // Override opzionali: se vuoti, il renderer usa la variante A/B dell'esperimento.
    eyebrow: shortText(160),
    headline: shortText(200),
    subhead: shortText(320),
    ctaLabel: shortText(40),
    // Scorciatoie alle categorie sotto la hero: visibili quando assente/true
    // (retro-compat). Optional (non .default) così i literal HomeSite restano
    // validi; renderer ed editor trattano "diverso da false" come visibile.
    showChips: z.boolean().optional(),
  })
  .default({});

const categoriesConfig = z.object({ heading: shortText(120), subheading: shortText(200) }).default({});

const popularProductsConfig = z
  .object({
    eyebrow: shortText(60),
    heading: shortText(120),
    limit: z.number().int().min(PRODUCTS_MIN).max(PRODUCTS_MAX).default(12),
  })
  .default({});

const liveActivityConfig = z
  .object({
    trustTitle: shortText(120),
    bullets: z
      .array(z.object({ title: z.string().trim().min(1).max(80), desc: z.string().trim().min(1).max(200) }))
      .max(6)
      .optional(),
  })
  .default({});

const nearbyStoresConfig = z
  .object({ eyebrow: shortText(60), heading: shortText(120), subheading: shortText(200) })
  .default({});

const newsletterConfig = z
  .object({ badge: shortText(40), heading: shortText(160), body: shortText(400) })
  .default({});

const sellerCtaConfig = z
  .object({ heading: shortText(120), subtext: shortText(200), ctaLabel: shortText(40), href: linkHrefSchema.optional() })
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
  cta: z.object({ label: z.string().trim().min(1).max(40), href: linkHrefSchema }).optional(),
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
    // 'youtube'/'vimeo' = embed via iframe (videoId). 'file' = MP4 self-hosted (videoUrl).
    provider: z.enum(['youtube', 'vimeo', 'file']).default('youtube'),
    videoId: z.string().trim().max(32).default(''),
    // URL https assoluto del file video (es. Supabase Storage) quando provider='file'.
    videoUrl: optionalHttpsUrl.default(''),
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'file') return; // file: l'URL https è già validato dallo schema; vuoto = incompleto, il render salta
    if (!v.videoId) return; // vuoto = sezione incompleta, il render la salta
    const ok = v.provider === 'youtube'
      ? /^[A-Za-z0-9_-]{11}$/.test(v.videoId)
      : /^[0-9]{6,12}$/.test(v.videoId);
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ID video non valido', path: ['videoId'] });
  });

/** Costruttore di uno schema-sezione discriminato su `type`. */
function section<T extends HomeSectionType, C extends z.ZodTypeAny>(type: T, config: C) {
  return z.object({
    id: idSchema,
    type: z.literal(type),
    enabled: z.boolean().default(true),
    config,
  });
}

export const homeSectionSchema = z.discriminatedUnion('type', [
  section('hero', heroConfig),
  section('howItWorks', emptyConfig),
  section('categories', categoriesConfig),
  section('dropOfDay', emptyConfig),
  section('popularProducts', popularProductsConfig),
  section('liveActivity', liveActivityConfig),
  section('nearbyStores', nearbyStoresConfig),
  section('reorder', emptyConfig),
  section('trustRow', emptyConfig),
  section('newsletter', newsletterConfig),
  section('sellerCta', sellerCtaConfig),
  section('shopOfMonth', headingConfig),
  section('stories', headingConfig),
  section('events', headingConfig),
  section('promo', headingConfig),
  section('trending', headingConfig),
  section('richText', richTextConfig),
  section('banner', bannerConfig),
  section('gallery', galleryConfig),
  section('video', videoConfig),
]);
export type HomeSection = z.infer<typeof homeSectionSchema>;

export const homeSiteSchema = z.object({
  version: z.literal(1).default(1),
  sections: z.array(homeSectionSchema).max(MAX_HOME_SECTIONS).default([]),
});
export type HomeSite = z.infer<typeof homeSiteSchema>;

/* ============================================================================
 * Default + normalizzazione (retro-compatibilità)
 * ========================================================================== */

/** Ordine fisso attuale di app/page.tsx (i testi di default sono nel renderer). */
const DEFAULT_ORDER: HomeSectionType[] = [
  'hero', 'reorder', 'howItWorks', 'categories', 'dropOfDay', 'popularProducts',
  'liveActivity', 'nearbyStores', 'trustRow', 'newsletter', 'sellerCta',
];

/** Home di default: riproduce il layout fisso attuale (id deterministici = type). */
export function defaultHomeSite(): HomeSite {
  return {
    version: 1,
    sections: DEFAULT_ORDER.map((type) => ({ ...newHomeSection(type), id: type })),
  };
}

/** Normalizza un valore qualsiasi (incl. JSONB dal DB) a una HomeSite renderizzabile. */
export function normalizeHomeSite(raw: unknown): HomeSite {
  if (raw && typeof raw === 'object' && Object.keys(raw as object).length > 0) {
    const parsed = homeSiteSchema.safeParse(raw);
    if (parsed.success && parsed.data.sections.length > 0) return parsed.data;
  }
  return defaultHomeSite();
}

/** Vero se la home è "vuota" (nessuna personalizzazione salvata): render = default. */
export function isDefaultHomeSite(raw: unknown): boolean {
  return !raw || typeof raw !== 'object' || Object.keys(raw as object).length === 0;
}

/* ============================================================================
 * Helper puri (unit-testabili)
 * ========================================================================== */

/** Sezioni effettivamente da renderizzare (solo quelle attive). */
export function homeEnabledSections(site: HomeSite): HomeSection[] {
  return site.sections.filter((s) => s.enabled);
}

/** href risolto di una CTA banner. null se vuoto. */
export function homeCtaHref(href: string | undefined | null): string | null {
  const v = (href ?? '').trim();
  return v.length > 0 ? v : null;
}

/** Crea una nuova sezione del tipo dato con config di default sensata (editor). */
export function newHomeSection(type: HomeSectionType): HomeSection {
  const id = newId();
  switch (type) {
    case 'richText':
      return { id, type, enabled: true, config: { heading: '', body: '' } };
    case 'banner':
      return { id, type, enabled: true, config: { imageUrl: '', heading: '', subheading: '', overlay: 'dark' } };
    case 'gallery':
      return { id, type, enabled: true, config: { heading: '', items: [] } };
    case 'video':
      return { id, type, enabled: true, config: { heading: '', provider: 'youtube', videoId: '', videoUrl: '' } };
    case 'popularProducts':
      return { id, type, enabled: true, config: { limit: 12 } };
    default:
      // strutturali senza config obbligatoria (override testuali opzionali → {})
      return { id, type, enabled: true, config: {} } as HomeSection;
  }
}
