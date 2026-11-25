import { z } from 'zod';
import { senzaPrezzo } from './scheda-cliente';
import type { SezioneSito } from './contenuti-servizi';

/**
 * LA BOZZA DEL SITO SCRITTA DALL'AD — 24/11/2026.
 *
 * Nicola: la bozza del sito fatta con l'IA la scrive «l'AD in un giro» — Claude Code sul suo piano,
 * MAI un'API a pagamento e MAI il sito che chiama da solo il piano. Quindi il sito non scrive niente
 * con l'IA: tiene l'elenco dei negozi che aspettano la bozza (GET /api/agenzia/bozza-sito, e la
 * pagina admin «Bozze del sito»), e riceve la bozza che l'AD manda (POST, stesso indirizzo).
 *
 * La porta è chiusa da un segreto suo, `AD_BOZZA_SITO_SEGRETO`, nell'intestazione
 * `x-mycity-segreto`: solo https, al massimo 32 KB.
 *
 * Regole della bozza (Nicola):
 *  · quattro sezioni: chi siamo, cosa offriamo, dove siamo e orari, contatti;
 *  · mai prezzi: un testo con un prezzo fa rifiutare tutta la bozza (422), e l'AD la riscrive;
 *  · mai dati inventati, e ogni testo è «da confermare dal titolare»: lo dice la bozza stessa
 *    (`stato: "da_confermare"`), e la pagina lo mostra su ogni sezione.
 */

export const SEZIONI_BOZZA = ['chi_siamo', 'cosa_offriamo', 'dove_siamo', 'contatti'] as const;
export type SezioneBozza = (typeof SEZIONI_BOZZA)[number];

export const TITOLI_SEZIONI: Record<SezioneBozza, string> = {
  chi_siamo: 'Chi siamo',
  cosa_offriamo: 'Cosa offriamo',
  dove_siamo: 'Dove siamo e orari',
  contatti: 'Contatti',
};

const SENZA_PREZZI = 'non deve contenere prezzi (li scrive il titolare)';
/** Gli orari («dalle 8.30 alle 19.30») non sono prezzi: si tolgono prima del controllo (collaudo, 24/11). */
export const senzaPrezzoTranneOrari = (t: string) => senzaPrezzo(t.replace(/\b\d{1,2}[.:]\d{2}\b/g, ' '));
const testoBozza = (min: number, max: number) => z.string().trim().min(min).max(max).refine(senzaPrezzoTranneOrari, SENZA_PREZZI);

const Sezione = z.object({
  testo: testoBozza(20, 1200),
  stato: z.literal('da_confermare'),
}).strict();

export const BozzaSitoInArrivo = z.object({
  tipo: z.literal('bozza-sito'),
  id_attivita: z.string().uuid('id_attivita non è un id valido'),
  scritta_il: z.string().datetime({ offset: true }),
  origine: z.string().trim().max(40).optional(),
  sottotitolo: testoBozza(3, 140).optional(),
  sezioni: z.object(Object.fromEntries(SEZIONI_BOZZA.map((s) => [s, Sezione])) as Record<SezioneBozza, typeof Sezione>).strict(),
  fonti: z.array(z.string().trim().max(500).regex(/^https:\/\//i, 'una fonte è un indirizzo https')).max(10).optional(),
}).strict();
export type BozzaSitoAd = z.infer<typeof BozzaSitoInArrivo>;

export function leggiBozzaSalvata(grezza: unknown): BozzaSitoAd | null {
  const e = BozzaSitoInArrivo.safeParse(grezza);
  return e.success ? e.data : null;
}

/** Le sezioni della bozza dell'AD nella forma della pagina «Sito web»: tutte da confermare. */
export function sezioniDellaBozza(b: BozzaSitoAd): SezioneSito[] {
  return SEZIONI_BOZZA.map((s) => ({ titolo: TITOLI_SEZIONI[s], testo: b.sezioni[s].testo, daConfermare: true, dalLocale: true }));
}

/* ─────────────────────── chi aspetta la bozza ─────────────────────── */

/** I negozi di sistema (MyCity, SDG) non hanno un sito da fare. */
export const PREFISSO_DI_SISTEMA = '11111111-1111-1111-1111-';

export type NegozioPerLaBozza = {
  id: string;
  ruolo: string | null;
  /** `store_customization.socials.website`: chi ha già un sito non aspetta la bozza. */
  sito: string | null;
  bozzaIl: string | null;
  schedaIl: string | null;
  /**
   * 25/11/2026 — Quando la scheda si è aperta (il primo abbonamento pagato: lib/agenzia/scheda-dopo-abbonamento.ts).
   * Una bozza scritta prima era senza i dati della scheda: va rifatta. `null` = non si sa o non c'entra.
   */
  schedaApertaIl?: string | null;
  /**
   * 25/11/2026 — Il sito che ha già, almeno un abbonamento lo rifà (Nicola, «ok sito»:
   * `sitoDaRifareInQualcheFascia` in lib/agenzia/offerta-su-misura.ts). Assente o falso: chi ha un sito non aspetta.
   */
  sitoDaRifare?: boolean;
};

export type InAttesa = { aspetta: true; perche: 'nessuna_bozza' | 'scheda_nuova' | 'scheda_aperta' | 'sito_da_rifare' } | { aspetta: false };

/**
 * Un negozio aspetta la bozza se è un venditore vero, non ha ancora un sito suo (o ce l'ha ma almeno un
 * abbonamento lo rifà, 25/11/2026) e: non ha una bozza,
 * oppure n8n gli ha mandato una scheda nuova dopo l'ultima bozza (i dati sono cambiati).
 */
export function aspettaLaBozza(n: NegozioPerLaBozza): InAttesa {
  if (n.ruolo !== 'seller' || n.id.toLowerCase().startsWith(PREFISSO_DI_SISTEMA)) return { aspetta: false };
  const haSito = !!(n.sito ?? '').trim();
  if (haSito && !n.sitoDaRifare) return { aspetta: false };
  if (!n.bozzaIl) return { aspetta: true, perche: haSito ? 'sito_da_rifare' : 'nessuna_bozza' };
  if (n.schedaIl && new Date(n.schedaIl).getTime() > new Date(n.bozzaIl).getTime()) return { aspetta: true, perche: 'scheda_nuova' };
  // La scheda c'era ma era chiusa (negozio in demo): al primo pagamento la bozza si rifà coi suoi dati.
  if (n.schedaIl && n.schedaApertaIl && new Date(n.schedaApertaIl).getTime() > new Date(n.bozzaIl).getTime()) return { aspetta: true, perche: 'scheda_aperta' };
  return { aspetta: false };
}
