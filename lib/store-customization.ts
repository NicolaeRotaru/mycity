import { z } from 'zod';

/**
 * Personalizzazione vetrina negozio — tipi, validazione (zod), cataloghi curati
 * e helper puri. Modulo "single source of truth" sul modello di lib/store-hours.ts.
 *
 * I dati vivono nella colonna JSONB profiles.store_customization (migration 052).
 * La validazione è in app (non nel DB), come per store_hours/store_media.
 *
 * Modalità COLORE: palette CURATA (scelta prodotto) — l'accent è sempre uno degli
 * hex dei preset qui sotto, tutti a livello ~-600 per garantire contrasto su testo
 * bianco. Per passare a "hex libero" basta sostituire accentSchema con un regex hex.
 */

/* ============================================================================
 * Cataloghi curati
 * ========================================================================== */

/** Colori brand-safe per l'accent della vetrina (sfondo con testo bianco). */
export const ACCENT_PRESETS = [
  { key: 'terracotta', label: 'Terracotta', hex: '#C0492C' }, // primary-600 (brand)
  { key: 'bordeaux',   label: 'Bordeaux',   hex: '#B82A28' }, // secondary-600
  { key: 'senape',     label: 'Senape',     hex: '#C4801F' }, // accent-600
  { key: 'oliva',      label: 'Oliva',      hex: '#5A7C42' }, // olive-600
  { key: 'salvia',     label: 'Salvia',     hex: '#2F6F6A' }, // teal on-brand
  { key: 'notte',      label: 'Notte',      hex: '#3B4A7A' }, // indigo smorzato
  { key: 'prugna',     label: 'Prugna',     hex: '#6B3A5B' },
  { key: 'cacao',      label: 'Cacao',      hex: '#5C4033' },
] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;
const ACCENT_HEXES: string[] = ACCENT_PRESETS.map((p) => p.hex);

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
const accentSchema = z.string().refine((v) => ACCENT_HEXES.includes(v), 'Colore non valido');
const coverSchema = z.string().refine((v) => COVER_KEYS.includes(v), 'Stile cover non valido');

// Handle social: opzionale, accetta stringa vuota. Niente URL completi (li costruiamo noi).
const handleSchema = z
  .string()
  .trim()
  .max(64, 'Massimo 64 caratteri')
  .regex(/^@?[A-Za-z0-9._-]+$/, 'Inserisci solo il nome utente, non il link completo')
  .optional()
  .or(z.literal(''));

const whatsappSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\s]{6,20}$/, 'Inserisci solo il numero (es. +39 333 1234567)')
  .optional()
  .or(z.literal(''));

// Accetta anche URL senza protocollo (es. "ilmionegozio.it") aggiungendo https://.
const websiteSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t) return '';
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  },
  z
    .string()
    .url('Inserisci un indirizzo valido (es. https://ilmionegozio.it)')
    .max(200)
    .optional()
    .or(z.literal('')),
);

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
  const a = c?.theme?.accent;
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
