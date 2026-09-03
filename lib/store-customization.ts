import { z } from 'zod';

/**
 * Personalizzazione vetrina negozio — tipi, validazione (zod), cataloghi curati
 * e helper puri. Modulo "single source of truth" sul modello di lib/store-hours.ts.
 *
 * I dati vivono nella colonna JSONB profiles.store_customization (migration 052).
 * La validazione è in app (non nel DB), come per store_hours/store_media.
 *
 * Modalità COLORE: palette CURATA (scelta prodotto) — l'accent è sempre uno degli
 * hex dei preset qui sotto, tutti presi dalle rampe di tailwind.config.ts e tutti
 * sopra 4,5 a 1 sul bianco, perché ci va sopra il testo bianco del pulsante della
 * vetrina. Per passare a "hex libero" basta sostituire accentSchema con un regex hex.
 */

/* ============================================================================
 * Cataloghi curati
 * ========================================================================== */

/**
 * Colori brand-safe per l'accent della vetrina (sfondo con testo bianco).
 *
 * 3/9/2026 — QUATTRO DI QUESTI OTTO COLORI NON ESISTEVANO NEL SITO.
 *
 * Salvia (#2F6F6A), Notte (#3B4A7A), Prugna (#6B3A5B) e Cacao (#5C4033) non
 * comparivano in `tailwind.config.ts`, in `app/globals.css` né nei token del
 * design: erano quattro tinte scritte a mano qui dentro. E non sono decorative:
 * l'accent finisce inline come sfondo del pulsante della vetrina, come striscia
 * della copertina e come colore delle icone dei contatti. Un negozio su
 * «Notte» aveva pulsanti indaco dentro una pagina con la barra terracotta e il
 * piede panna — sembrava un pezzo di un altro sito incollato dentro il nostro.
 *
 * Adesso gli otto colori escono TUTTI dalle rampe del design system. La causa
 * era il modo: l'elenco nasceva a mano, senza nessuno che lo confrontasse con
 * la tavolozza. La prova `tests/unit/la-vetrina-del-negozio-resta-nei-colori-del-sito.test.ts`
 * legge le rampe da `tailwind.config.ts` e pretende che ogni preset sia una di
 * quelle: il prossimo colore inventato diventa rosso.
 */
export const ACCENT_PRESETS = [
  { key: 'terracotta', label: 'Terracotta', hex: '#C0492C' }, // primary-600 (brand)
  { key: 'bordeaux',   label: 'Bordeaux',   hex: '#B82A28' }, // secondary-600
  { key: 'senape',     label: 'Senape',     hex: '#9D621C' }, // accent-700
  { key: 'oliva',      label: 'Oliva',      hex: '#5A7C42' }, // olive-600
  { key: 'bosco',      label: 'Bosco',      hex: '#456236' }, // olive-700
  { key: 'cacao',      label: 'Cacao',      hex: '#69411C' }, // accent-900
  { key: 'vino',       label: 'Vino',       hex: '#5C211A' }, // primary-900
  { key: 'inchiostro', label: 'Inchiostro', hex: '#2C2A28' }, // ink-800
] as const;

/**
 * I colori ritirati e dove finisce chi li aveva scelti.
 *
 * NON è un vezzo, ed è la parte più pericolosa di tutta la riparazione. La
 * validazione qui è tutto-o-niente: un accent che non è più nell'elenco fa
 * fallire l'INTERO `storeCustomization`, che torna vuoto. E chi lo usa non lo
 * legge soltanto — `components/seller/site/ThemePicker.tsx` fa leggi-modifica-
 * scrivi: legge la personalizzazione, ci mette il colore nuovo e RISCRIVE la
 * riga. Quindi togliere i quattro colori senza rimpiazzo vorrebbe dire che il
 * primo negoziante su «Notte» che cambia colore si vede cancellare dal database
 * motto, social, badge, prodotti in vetrina e stile della copertina. Per sempre.
 * Il difetto che stiamo riparando è un colore stonato: la riparazione fatta a
 * metà sarebbe stata la perdita dei dati di un negoziante.
 *
 * La destinazione è il colore della tavolozza più vicino a occhio (distanza
 * CIE76 in Lab), con la tinta rispettata dove esisteva: chi aveva il verde-acqua
 * resta sul verde. Nessuna migrazione: la riga nel database tiene il vecchio
 * esadecimale finché il negoziante non salva, e chi legge vede già il nuovo.
 */
export const ACCENT_RITIRATI: Readonly<Record<string, string>> = {
  '#2F6F6A': '#456236', // Salvia  → Bosco      (ΔE 25,5: il verde più vicino che abbiamo)
  '#3B4A7A': '#2C2A28', // Notte   → Inchiostro (ΔE 35,3: nella tavolozza non c'è nessun blu)
  '#6B3A5B': '#5C211A', // Prugna  → Vino       (ΔE 30,5)
  '#5C4033': '#69411C', // Cacao   → Cacao      (ΔE 16,7: stesso nome, tinta del design)
  // Senape era accent-600 (#C4801F). È nella tavolozza, ma sul pulsante della
  // vetrina ci va sopra il testo bianco e il rapporto era 3,25 a 1: sotto il
  // 4,5 che serve per leggere. Un tono più giù (accent-700) sale a 5,0 e resta
  // la stessa ocra. Il commento in cima al file prometteva già che questi
  // colori garantissero il contrasto sul bianco: adesso è vero.
  '#C4801F': '#9D621C', // Senape  → Senape     (contrasto 3,25 → 5,00)
};

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;
const ACCENT_HEXES: string[] = ACCENT_PRESETS.map((p) => p.hex);

/** Il colore vero da usare: i ritirati diventano il loro sostituto. */
function accentVivo(v: string): string {
  return ACCENT_RITIRATI[v] ?? v;
}

/** Gradienti per la cover quando il negozio non ha foto/video (tutti on-brand). */
export const COVER_PRESETS = [
  { key: 'terracotta', label: 'Cotto',     className: 'bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600' },
  { key: 'tramonto',   label: 'Tramonto',  className: 'bg-gradient-to-br from-accent-400 via-primary-500 to-secondary-600' },
  { key: 'colli',      label: 'Colli',     className: 'bg-gradient-to-br from-olive-400 via-olive-600 to-ink-700' },
  { key: 'lino',       label: 'Lino',      className: 'bg-gradient-to-br from-cream-200 via-cream-300 to-accent-200' },
  { key: 'zafferano',  label: 'Zafferano', className: 'bg-gradient-to-br from-accent-300 via-accent-500 to-primary-600' },
  { key: 'notte',      label: 'Notte',     className: 'bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900' },
] as const;

export const DEFAULT_COVER = COVER_PRESETS[0].key;
const COVER_KEYS: string[] = COVER_PRESETS.map((p) => p.key);

/** Badge "punti di forza" selezionabili dal venditore (catalogo chiuso). */
export const BADGE_CATALOG = [
  { key: 'produzione_propria', label: 'Produzione propria' },
  { key: 'consegna_rapida',    label: 'Consegna rapida' },
  { key: 'prodotti_locali',    label: 'Prodotti locali' },
  { key: 'tradizione',         label: 'Tradizione di famiglia' },
  { key: 'bio',                label: 'Biologico' },
  { key: 'artigianale',        label: 'Artigianale' },
  { key: 'ritiro_in_negozio',  label: 'Ritiro in negozio' },
  { key: 'sostenibile',        label: 'Sostenibile' },
] as const;

export type BadgeKey = (typeof BADGE_CATALOG)[number]['key'];
const BADGE_KEYS: string[] = BADGE_CATALOG.map((b) => b.key);

export const MAX_FEATURED = 8;
export const MAX_BADGES = 6;
export const MAX_TAGLINE = 80;
export const MAX_ANNOUNCEMENT = 160;

/* ============================================================================
 * Schema di validazione (zod)
 * ========================================================================== */

// Modalità curata: accent ∈ hex dei preset. (hex libero => z.string().regex(/^#[0-9a-fA-F]{6}$/))
// I colori ritirati passano dal rimpiazzo PRIMA del controllo: se cadessero qui,
// tutta la personalizzazione del negozio verrebbe buttata via insieme a loro.
const accentSchema = z
  .string()
  .transform(accentVivo)
  .refine((v) => ACCENT_HEXES.includes(v), 'Colore non valido');
const coverSchema = z.string().refine((v) => COVER_KEYS.includes(v), 'Stile cover non valido');

// Handle social: opzionale, accetta stringa vuota. Niente URL completi (li costruiamo noi).
const handleSchema = z
  .string()
  .trim()
  .max(64, 'Troppo lungo')
  .regex(/^@?[A-Za-z0-9._-]+$/, 'Handle non valido')
  .optional()
  .or(z.literal(''));

const whatsappSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\s]{6,20}$/, 'Numero non valido')
  .optional()
  .or(z.literal(''));

const websiteSchema = z
  .string()
  .trim()
  .url('URL non valido')
  .max(200)
  .optional()
  .or(z.literal(''));

export const storeCustomizationSchema = z.object({
  theme: z
    .object({
      accent: accentSchema.optional(),
      coverStyle: coverSchema.optional(),
    })
    .optional(),
  tagline: z.string().trim().max(MAX_TAGLINE, `Massimo ${MAX_TAGLINE} caratteri`).optional().or(z.literal('')),
  socials: z
    .object({
      instagram: handleSchema,
      facebook: handleSchema,
      tiktok: handleSchema,
      whatsapp: whatsappSchema,
      website: websiteSchema,
    })
    .optional(),
  announcement: z
    .object({
      enabled: z.boolean().default(false),
      text: z.string().trim().max(MAX_ANNOUNCEMENT, `Massimo ${MAX_ANNOUNCEMENT} caratteri`).default(''),
      until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida')
        .optional()
        .or(z.literal('')),
    })
    .optional(),
  featuredProductIds: z.array(z.string().uuid()).max(MAX_FEATURED).optional(),
  badges: z
    .array(z.string().refine((v) => BADGE_KEYS.includes(v), 'Badge non valido'))
    .max(MAX_BADGES)
    .optional(),
});

export type StoreCustomization = z.infer<typeof storeCustomizationSchema>;

/* ============================================================================
 * Helper puri (unit-testabili come lib/store-hours.ts)
 * ========================================================================== */

/** Normalizza un valore qualsiasi (incl. JSONB dal DB) a una StoreCustomization sicura. */
export function normalizeCustomization(raw: unknown): StoreCustomization {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = storeCustomizationSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Hex dell'accent, con fallback al brand se assente/non valido. */
export function accentHex(c?: StoreCustomization | null): string {
  const a = c?.theme?.accent ? accentVivo(c.theme.accent) : undefined;
  return a && ACCENT_HEXES.includes(a) ? a : DEFAULT_ACCENT;
}

/** Classe Tailwind del gradiente cover (fallback al primo preset on-brand). */
export function coverClassName(c?: StoreCustomization | null): string {
  const k = c?.theme?.coverStyle;
  return COVER_PRESETS.find((p) => p.key === k)?.className ?? COVER_PRESETS[0].className;
}

/** Vero se l'annuncio è abilitato, ha testo e non è scaduto. */
export function announcementActive(c?: StoreCustomization | null, now: Date = new Date()): boolean {
  const a = c?.announcement;
  if (!a?.enabled) return false;
  if (!a.text || !a.text.trim()) return false;
  if (a.until) {
    const d = new Date(`${a.until}T23:59:59`);
    if (!Number.isNaN(d.getTime()) && d < now) return false;
  }
  return true;
}

export type SocialLink = { key: string; label: string; href: string };

function cleanHandle(v?: string): string | null {
  if (!v) return null;
  const h = v.trim().replace(/^@+/, '');
  return /^[A-Za-z0-9._-]+$/.test(h) ? h : null;
}

/** Costruisce i link social assoluti e validati (scarta valori malformati). */
export function socialLinks(c?: StoreCustomization | null): SocialLink[] {
  const s = c?.socials;
  if (!s) return [];
  const out: SocialLink[] = [];

  const ig = cleanHandle(s.instagram);
  if (ig) out.push({ key: 'instagram', label: 'Instagram', href: `https://instagram.com/${ig}` });

  const fb = cleanHandle(s.facebook);
  if (fb) out.push({ key: 'facebook', label: 'Facebook', href: `https://facebook.com/${fb}` });

  const tk = cleanHandle(s.tiktok);
  if (tk) out.push({ key: 'tiktok', label: 'TikTok', href: `https://www.tiktok.com/@${tk}` });

  const wa = (s.whatsapp ?? '').replace(/[^0-9]/g, '');
  if (wa.length >= 6) out.push({ key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${wa}` });

  const web = (s.website ?? '').trim();
  if (web && /^https?:\/\//i.test(web)) out.push({ key: 'website', label: 'Sito web', href: web });

  return out;
}

export function badgeLabel(key: string): string {
  return BADGE_CATALOG.find((b) => b.key === key)?.label ?? key;
}
