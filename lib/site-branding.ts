import { CONSEGNA_ALL_ORA_CHE_SCEGLI, CONSEGNA_FRASE_INTERA } from '@/lib/promessa-consegna';
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

export type Branding = {
  announcement: { items: { icon: WedgeIconKey; text: string }[]; promoLinkEnabled: boolean };
  wordmark: { accent: string; rest: string };
  footerTagline: string;
};

type Esito<T> = { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };

/*
 * 24/11/2026 — La validazione era scritta con zod, che entrava intero nel pacchetto comune solo per
 * questo marchio. Stesse regole a mano (potare gli spazi, limiti di lunghezza, valori di partenza,
 * campi sconosciuti scartati); `safeParse` ha la stessa forma di prima per chi la chiama
 * (app/admin/branding, app/api/admin/branding).
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseBranding(input: unknown): Esito<Branding> {
  const issues: { message: string }[] = [];
  const err = (m: string) => { issues.push({ message: m }); };
  const gruppo = (v: unknown): Record<string, unknown> => {
    if (v === undefined) return {};
    if (isObj(v)) return v;
    err('Valore non valido: serve un gruppo di dati');
    return {};
  };
  const testo = (v: unknown, max: number, def: string, minUno = false): string => {
    if (v === undefined && !minUno) return def;
    if (typeof v !== 'string') { err(v === undefined ? 'Campo obbligatorio' : 'Valore non valido: serve un testo'); return def; }
    const t = v.trim();
    if (minUno && t.length < 1) err('Campo obbligatorio');
    if (t.length > max) err(`Massimo ${max} caratteri`);
    return t;
  };

  const root = gruppo(input);
  const ann = gruppo(root.announcement);
  const items: Branding['announcement']['items'] = [];
  if (ann.items !== undefined) {
    if (!Array.isArray(ann.items)) err('Valore non valido: serve un elenco');
    else {
      if (ann.items.length > MAX_WEDGE_ITEMS) err(`Massimo ${MAX_WEDGE_ITEMS} elementi`);
      for (const it of ann.items) {
        if (!isObj(it)) { err('Valore non valido: serve un gruppo di dati'); continue; }
        if (!(WEDGE_ICON_KEYS as readonly unknown[]).includes(it.icon)) err('Valore non valido: scegline uno fra quelli proposti');
        items.push({ icon: it.icon as WedgeIconKey, text: testo(it.text, 60, '', true) });
      }
    }
  }
  let promoLinkEnabled = true;
  if (ann.promoLinkEnabled !== undefined) {
    if (typeof ann.promoLinkEnabled === 'boolean') promoLinkEnabled = ann.promoLinkEnabled;
    else err('Valore non valido: serve sì o no');
  }
  const wm = gruppo(root.wordmark);
  const accent = testo(wm.accent, 20, 'My');
  const rest = testo(wm.rest, 20, 'City');
  const footerTagline = testo(root.footerTagline, 220, '');

  if (issues.length > 0) return { success: false, error: { issues } };
  return { success: true, data: { announcement: { items, promoLinkEnabled }, wordmark: { accent, rest }, footerTagline } };
}

export const brandingSchema = { safeParse: parseBranding };

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
  `Compra online dai negozi di Piacenza. ${CONSEGNA_ALL_ORA_CHE_SCEGLI}, pagamento alla consegna.`;

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
  // 5/11/2026 — Riconosceva solo «30-60 min»: «da 30 a 60 minuti», «30/60 min»
  // e «in mezz'ora» passavano. Stessa promessa, altre parole.
  const trentaSessanta = /\b30\s*(?:[-–—/]|a)\s*60\s*min/.test(t) || /\bmezz['’ ]?\s*ora\b/.test(t);
  if (trentaSessanta && !/\bveloce\b/.test(t)) {
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
