import { z } from 'zod';
import {
  Banknote, Zap, MapPin, Truck, ShieldCheck, Tag, Sparkles, Gift, Heart, Check,
  Store, Clock, type LucideIcon,
} from 'lucide-react';

/**
 * Branding globale del marketplace — barra annunci ("wedge"), wordmark e footer.
 * Vive nella colonna JSONB site_settings.branding (migration 075), gestito dall'admin
 * via /admin/branding. Validazione in app (zod), sul modello di lib/store-customization.ts.
 *
 * NB: il tema colori globale (palette primary/accent) NON è qui: cambiarlo richiede un
 * refactor a CSS-variables dell'intero tema Tailwind. Qui restano i contenuti
 * realmente editabili a runtime senza ricompilare il tema.
 *
 * Retro-compatibilità: branding assente/{} => `normalizeBranding` ritorna i default
 * (gli stessi testi hardcoded attuali di PromoTicker/Navbar/Footer).
 */

/* Icone ammesse per gli elementi della barra annunci (closed set, anti-abuso). */
export const WEDGE_ICON_KEYS = [
  'banknote', 'zap', 'mappin', 'truck', 'shield', 'tag', 'sparkles', 'gift', 'heart', 'check', 'store', 'clock',
] as const;
export type WedgeIconKey = (typeof WEDGE_ICON_KEYS)[number];

export const WEDGE_ICONS: Record<WedgeIconKey, LucideIcon> = {
  banknote: Banknote, zap: Zap, mappin: MapPin, truck: Truck, shield: ShieldCheck,
  tag: Tag, sparkles: Sparkles, gift: Gift, heart: Heart, check: Check, store: Store, clock: Clock,
};

export function wedgeIcon(key: string): LucideIcon {
  return WEDGE_ICONS[key as WedgeIconKey] ?? WEDGE_ICONS.tag;
}

export const MAX_WEDGE_ITEMS = 5;

const wedgeItemSchema = z.object({
  icon: z.enum(WEDGE_ICON_KEYS),
  text: z.string().trim().min(1).max(60),
});

export const brandingSchema = z
  .object({
    announcement: z
      .object({
        items: z.array(wedgeItemSchema).max(MAX_WEDGE_ITEMS).default([]),
        promoLinkEnabled: z.boolean().default(true),
      })
      .default({}),
    wordmark: z
      .object({
        accent: z.string().trim().max(20).default('My'),
        rest: z.string().trim().max(20).default('City'),
      })
      .default({}),
    footerTagline: z.string().trim().max(220).default(''),
  })
  .default({});
export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_WEDGE_ITEMS: { icon: WedgeIconKey; text: string }[] = [
  { icon: 'banknote', text: 'Paghi alla consegna' },
  { icon: 'zap', text: 'Consegna in 24-48h' },
  { icon: 'mappin', text: 'Negozi veri di Piacenza' },
];

export const DEFAULT_FOOTER_TAGLINE =
  'Il marketplace dei negozi di Piacenza. Compra dai commercianti locali, ricevi a casa in 24-48h.';

export function defaultBranding(): Branding {
  return {
    announcement: { items: DEFAULT_WEDGE_ITEMS.map((i) => ({ ...i })), promoLinkEnabled: true },
    wordmark: { accent: 'My', rest: 'City' },
    footerTagline: DEFAULT_FOOTER_TAGLINE,
  };
}

/** Normalizza il JSONB dal DB a un Branding renderizzabile, riempiendo i vuoti coi default. */
export function normalizeBranding(raw: unknown): Branding {
  if (raw && typeof raw === 'object' && Object.keys(raw as object).length > 0) {
    const parsed = brandingSchema.safeParse(raw);
    if (parsed.success) {
      const b = parsed.data;
      return {
        announcement: {
          items: b.announcement.items.length > 0 ? b.announcement.items : DEFAULT_WEDGE_ITEMS.map((i) => ({ ...i })),
          promoLinkEnabled: b.announcement.promoLinkEnabled,
        },
        wordmark: { accent: b.wordmark.accent || 'My', rest: b.wordmark.rest || 'City' },
        footerTagline: b.footerTagline || DEFAULT_FOOTER_TAGLINE,
      };
    }
  }
  return defaultBranding();
}
