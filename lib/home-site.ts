import { z } from 'zod';
import { newId, siteByteSize, MAX_SITE_BYTES } from './store-site';
import { safeInternalPath } from './safe-redirect';

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

/**
 * L'ordine con cui esce la home quando nessuno l'ha ancora composta dal pannello.
 *
 * 3/9/2026 — IL PRIMO PRODOTTO DA COMPRARE ARRIVAVA DOPO TRE SEZIONI INTERE.
 *
 * L'ordine era: hero, «ordina di nuovo», «come funziona», categorie, offerta del
 * giorno, prodotti popolari. Per chi non ha fatto accesso — cioè chi arriva la
 * prima volta, cioè quasi tutti — «ordina di nuovo» si nasconde da sola e
 * l'offerta del giorno c'è solo se un'offerta è stata programmata. Quindi
 * l'ordine vero era: hero → come funziona → categorie → primo prodotto.
 *
 * IL CONTO, rifatto sulle classi vere per un telefono da 360 punti (il calcolo
 * sta per esteso nella prova `in-home-il-primo-prodotto-non-sta-sotto-tre-sezioni`):
 *
 *   hero            ~783 punti   (la scheda-negozio a fianco è nascosta sotto md)
 *   come funziona   ~761 punti   (tre schede impilate, una sotto l'altra)
 *   categorie       ~505 punti   (sei tessere su tre righe)
 *   ─────────────────────────────
 *   il primo articolo con foto e prezzo cominciava a ~2.150 punti dall'alto,
 *   cioè dopo quasi QUATTRO schermate di telefono.
 *
 * Su un negozio di paese si può raccontare prima chi sei. Su un mercato no: chi
 * apre la home vuole vedere della roba da comprare, e se non la vede se ne va.
 * «Come funziona» spiega una cosa che nessuno ha ancora deciso di fare.
 *
 * Adesso i prodotti popolari stanno subito sotto l'hero — il primo articolo
 * comincia a ~900 punti, meno di due schermate — e «come funziona» scende sotto
 * i negozi vicini, dove risponde a una domanda che a quel punto uno se l'è fatta.
 *
 * ⚠️ Questo è il DEFAULT: vale finché `site_settings.home_site` è vuota. Se la
 * home è già stata composta dal pannello, l'ordine sta nel database e va
 * cambiato da lì (/admin/home) — vedi `sezioniPrimaDelPrimoProdotto` qui sotto,
 * che è la stessa misura applicabile a una home qualunque.
 */
const DEFAULT_ORDER: HomeSectionType[] = [
  'hero', 'reorder', 'popularProducts', 'categories', 'dropOfDay',
  'liveActivity', 'nearbyStores', 'howItWorks', 'trustRow', 'newsletter', 'sellerCta',
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

/**
 * Le sezioni che mettono davanti a chi guarda un articolo con foto, prezzo e un
 * modo per comprarlo.
 *
 * Non ci sono le categorie: una tessera «Alimentari» è un cartello, non della
 * merce. Chi la tocca fa un passo in più prima di vedere un prezzo.
 */
export const SEZIONI_CHE_VENDONO: HomeSectionType[] = [
  'reorder', 'popularProducts', 'dropOfDay', 'promo', 'trending',
];

/**
 * Le sezioni che a un visitatore nuovo non compaiono, per quanto in alto stiano.
 *
 * `reorder` si nasconde da sola quando nessuno ha fatto accesso
 * (components/home-sections/ReorderRail.tsx: «ospite → self-hide»), e le altre
 * spariscono quando non hanno niente da mostrare: un'offerta del giorno che
 * nessuno ha programmato, una promozione scaduta, una classifica vuota.
 *
 * Metterle in alto quindi non conta come «il visitatore vede subito dei
 * prodotti»: nel caso peggiore — che è il caso normale del primo giorno — sopra
 * non c'è niente.
 */
export const SEZIONI_CHE_POSSONO_NON_COMPARIRE: HomeSectionType[] = [
  'reorder', 'dropOfDay', 'promo', 'trending', 'stories', 'events', 'shopOfMonth',
];

/**
 * Cosa scorre un visitatore nuovo PRIMA di incontrare il primo articolo che può
 * comprare. Restituisce i tipi delle sezioni che stanno sopra, in ordine.
 *
 * È la misura del difetto del 3/9/2026: sulla home di partenza tornava
 * `['howItWorks', 'categories']` — due sezioni intere, circa 1.270 punti di
 * scorrimento — e adesso torna `[]`, perché sotto l'hero c'è già della merce.
 *
 * Serve anche per una home composta a mano dal pannello: la stessa domanda,
 * fatta a una configurazione qualunque.
 */
export function sezioniPrimaDelPrimoProdotto(site: HomeSite): HomeSectionType[] {
  const sopra: HomeSectionType[] = [];
  for (const s of homeEnabledSections(site)) {
    // L'hero non conta: è l'intestazione della pagina, non una sezione da scorrere.
    if (s.type === 'hero') continue;
    const vende = SEZIONI_CHE_VENDONO.includes(s.type);
    const puoNonEsserci = SEZIONI_CHE_POSSONO_NON_COMPARIRE.includes(s.type);
    if (vende && !puoNonEsserci) return sopra;
    if (puoNonEsserci) continue; // non la vede: non gli costa scorrimento
    sopra.push(s.type);
  }
  return sopra;
}

/**
 * href risolto di una CTA banner: `null` se vuoto — e anche se non e' un
 * indirizzo che possiamo mettere sotto le mani di un cliente.
 *
 * 30/8/2026 (R027) — QUI SOPRA C'ERA SCRITTO CHE SI CONTROLLAVA, E NON SI
 * CONTROLLAVA.
 *
 * Il renderer dei blocchi CMS dichiara «link CTA solo https/percorso interno»
 * e mette il valore dentro `<a href>`; questa funzione, che e' il punto in cui
 * quel controllo dovrebbe stare, restituiva la stringa cosi' com'era. Oggi
 * nessuna strada di scrittura lo permette (lo schema di validazione impone gia'
 * https o percorso interno), ma una difesa dichiarata dove non esiste e' il
 * modo piu' rapido per farne nascere una vera un domani: chi legge il commento
 * smette di guardare.
 *
 * Regola: `https://…` oppure un percorso interno che comincia con UNA sola
 * barra (`safeInternalPath` respinge `//altro-sito`, le barre rovesciate e gli
 * schemi tipo `javascript:`). Tutto il resto: nessun bottone.
 */
export function homeCtaHref(href: string | undefined | null): string | null {
  const v = (href ?? '').trim();
  if (v.length === 0 || v.length > 500) return null;
  try {
    // Indirizzo assoluto: passa solo se e' https.
    const assoluto = new URL(v);
    return assoluto.protocol === 'https:' ? v : null;
  } catch {
    // Non e' un indirizzo assoluto: allora deve essere un percorso nostro.
  }
  const interno = safeInternalPath(v, '');
  return interno.length > 0 ? interno : null;
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
