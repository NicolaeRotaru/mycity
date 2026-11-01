import { CONSEGNA_ALL_ORA_CHE_SCEGLI, CONSEGNA_FRASE_INTERA } from '@/lib/promessa-consegna';
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
  // 29/10/2026 — Erano i minuti della veloce, promessi con un solo fattorino in attesa di approvazione: la
  // consegna normale arriva all'ora che sceglie il cliente, la veloce solo se c'è chi la fa.
  { icon: 'zap', text: CONSEGNA_ALL_ORA_CHE_SCEGLI },
  { icon: 'mappin', text: 'Negozi veri di Piacenza' },
];

export const DEFAULT_FOOTER_TAGLINE =
  `Il marketplace dei negozi di Piacenza. Compra dai commercianti locali. ${CONSEGNA_FRASE_INTERA}.`;

/**
 * La descrizione del sito per Google e per le anteprime dei link (app/layout.tsx).
 * 29/10/2026 — Diceva «alimentari, abbigliamento, casa…»: al lancio l'abbigliamento non c'è
 * (registro dei fatti, catalogo.categorie, Nicola 29/10 alle 00:05). Vive qui, accanto agli altri
 * testi del sito, perché la radice del sito non si può importare in una prova.
 * Prova: tests/unit/le-frasi-della-consegna-non-tornano-indietro.test.tsx
 */
export const DESCRIZIONE_DEL_SITO =
  `Compra online dai negozi di Piacenza: alimentari, casa, elettronica, libri. ${CONSEGNA_ALL_ORA_CHE_SCEGLI}, pagamento alla consegna.`;

/**
 * 01/11/2026 — Le frasi salvate dall'amministratore vincono sui testi del codice: una riga scritta
 * prima delle ondate 13-14 resterebbe pubblicata anche dopo l'unione (è successo all'eroe della
 * home, site_settings.home_site, salvato il 24/6: «abbigliamento… arriva a casa in 30-60 min»).
 * Questo è il freno: riconosce le due promesse superate — l'abbigliamento, che al lancio non c'è
 * (catalogo.categorie), e i 30-60 minuti dati come cosa certa, senza dire che sono la veloce
 * (consegna.promessa, Nicola 29/10). Ritorna il motivo, oppure null se il testo è a posto.
 * Prova: tests/unit/il-branding-salvato-non-ripubblica-promesse-superate.test.ts
 */
export function promessaSuperata(testo: string): string | null {
  const t = testo.toLowerCase();
  if (/\babbigliamento\b/.test(t)) return 'abbigliamento: al lancio non c\'è';
  if (/\b30\s*[-–]\s*60\s*min/.test(t) && !/\bveloce\b/.test(t)) {
    return '30-60 minuti promessi come certi, senza dire che sono la consegna veloce';
  }
  return null;
}

function scartaSeSuperata(campo: string, testo: string): boolean {
  const motivo = promessaSuperata(testo);
  if (motivo) {
    // Non sparisce in silenzio: chi legge i log sa quale frase salvata va riscritta da /admin/branding.
    console.error(`[site-branding] frase salvata scartata (${campo}): ${motivo} — «${testo}»`);
    return true;
  }
  return false;
}

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
      const items = b.announcement.items.filter((i) => !scartaSeSuperata('announcement', i.text));
      const tagline = b.footerTagline && !scartaSeSuperata('footerTagline', b.footerTagline) ? b.footerTagline : '';
      return {
        announcement: {
          items: items.length > 0 ? items : DEFAULT_WEDGE_ITEMS.map((i) => ({ ...i })),
          promoLinkEnabled: b.announcement.promoLinkEnabled,
        },
        wordmark: { accent: b.wordmark.accent || 'My', rest: b.wordmark.rest || 'City' },
        footerTagline: tagline || DEFAULT_FOOTER_TAGLINE,
      };
    }
  }
  return defaultBranding();
}
