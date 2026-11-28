import { z } from 'zod';

/**
 * IL LAVORO PREMIUM CONSEGNATO — 27/11/2026.
 * Le tre forme dei file scritti per il cliente (contratto: consegne/sdg-premium/CONTRATTO.md).
 * Gli indirizzi sono solo https://. Dove il contratto dice «o null», il campo accetta anche null/assente.
 */
const https = z.string().url().refine((s) => s.startsWith('https://'), 'serve un indirizzo https://');
const httpsONull = https.nullish();
const testo = z.string();
const elenco = z.array(testo).default([]);
const strato = z.enum(['base', 'business', 'premium']);

export const AnalisiSchema = z.object({
  titolo: testo,
  aggiornata_il: testo,
  sintesi: testo,
  numeri_chiave: z.array(z.object({ voce: testo, valore: testo, fonte: httpsONull, da_confermare: z.boolean().nullish() })).default([]),
  mercato: z.array(z.object({ titolo: testo, testo, fonti: z.array(https).default([]) })).default([]),
  concorrenti: z.array(z.object({
    nome: testo, tipo: testo.nullish(), cosa_fanno: testo, prezzo_indicativo: testo.nullish(),
    punti_forti: elenco, punti_deboli: elenco, fonte: httpsONull,
  })).default([]),
  swot: z.object({ forze: elenco, debolezze: elenco, opportunita: elenco, minacce: elenco }),
  clienti_tipo: z.array(z.object({ nome: testo, bisogno: testo, abbonamento_adatto: strato.nullish(), perche: testo.nullish() })).default([]),
  prezzi: z.array(z.object({ voce: testo, confronto: testo })).default([]),
  presenza_online_sdg: z.array(z.object({ canale: testo, stato: testo, indirizzo: httpsONull, nota: testo.nullish() })).default([]),
  raccomandazioni: z.array(z.object({ priorita: z.number(), cosa: testo, perche: testo, quando: testo.nullish(), costo: testo.nullish() })).default([]),
  fonti: z.array(https).default([]),
});
export type Analisi = z.infer<typeof AnalisiSchema>;

export const SocialSchema = z.object({
  titolo: testo,
  fascia: strato,
  mese: testo,
  aggiornato_il: testo,
  obiettivo: testo,
  a_chi_parliamo: testo,
  // 28/11/2026 — Lo standard per ogni cliente (lib/agenzia/social-standard.ts): canali e tono del piano dell'AD,
  // il titolo della parte «oltre il calendario» (per SDG resta «Extra Premium»), l'evento in città con la sua fonte.
  tono: testo.nullish(),
  canali: z.array(z.object({ nome: testo, account: testo.nullish(), ruolo: testo, da_aprire: z.boolean().default(false) })).default([]),
  pilastri: z.array(z.object({ nome: testo, percentuale: z.number(), descrizione: testo })).default([]),
  quantita: z.array(z.object({ voce: testo, quanti: z.number() })).default([]),
  calendario: z.array(z.object({
    giorno: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ora: z.string().regex(/^\d{2}:\d{2}$/),
    canale: testo, formato: testo, pilastro: testo, titolo: testo, testo,
    strato, stato: testo.default('da_approvare'),
    in_citta: testo.nullish(), fonte_evento: httpsONull,
  })).default([]),
  titolo_extra: testo.nullish(),
  extra_premium: z.array(z.object({ voce: testo, cosa: testo, costo_fuori_canone: testo.nullish() })).default([]),
  misure: z.array(z.object({ kpi: testo, obiettivo: testo, come_si_misura: testo })).default([]),
  regole: elenco,
});
export type Social = z.infer<typeof SocialSchema>;

export const SitoSchema = z.object({
  titolo: testo,
  aggiornato_il: testo,
  stato: z.enum(['da_pubblicare', 'online']),
  indirizzo: httpsONull,
  codice: httpsONull,
  // 27/11/2026 — Un'immagine della home, servita dal sito MyCity stesso (cartella public/lavoro-consegnato/):
  // si vede anche prima che il sito sia online, per esempio nella pagina del link del preventivo.
  anteprima: z.string().regex(/^\/lavoro-consegnato\/[a-z0-9-]+\/[a-z0-9-]+\.(jpg|png|webp)$/, "l'anteprima è un'immagine in public/lavoro-consegnato/<negozio>/").nullish(),
  pagine: z.array(z.object({ titolo: testo, percorso: testo, cosa_contiene: testo })).default([]),
  cosa_ha_di_premium: elenco,
  // 27/11/2026 — Il sito del Caffè di Piacenza è Business: la stessa lista, col nome della sua fascia.
  cosa_ha_di_business: elenco,
  da_confermare: z.array(z.object({ voce: testo, perche: testo })).default([]),
  prossimi_passi: z.array(z.object({ cosa: testo, chi: testo, colore: testo.nullish() })).default([]),
});
export type Sito = z.infer<typeof SitoSchema>;

export type LavoroConsegnato = {
  negozioId: string;
  fascia: 'base' | 'business' | 'premium';
  sito?: Sito;
  social?: Social;
  analisi?: Analisi;
};

/** 27/11/2026 — Una riga della pagina Admin «Lavoro dei clienti». */
export type NegozioConLavoro = { negozioId: string; nome: string; lavoro: LavoroConsegnato };
