import { z } from 'zod';
import { giornoDiPiacenza } from './preventivo';
import { senzaPrezzo, vociSenzaPrezzo, type SchedaCliente } from './scheda-cliente';

/**
 * L'ANALISI DEL BUSINESS — il quarto servizio (24/11/2026).
 *
 * Nicola: «manca un'ultima cosa dentro i servizi, l'analisi del business, la fa n8n… E dentro il
 * servizio di analisi, oltre all'analisi che già n8n fa, ci deve essere anche l'analisi dei social,
 * google, sito». Le sue scelte dello stesso giorno: solo fonti gratuite; il ritmo «Avvio, mese,
 * settimana» (Base, Business, Premium: lo dice `FASCE` in preventivo.ts).
 *
 * Tre parti, e da dove arriva ognuna:
 *  1. L'ATTIVITÀ — la lettura di n8n (flusso 16, la ricerca sul web) che arriva dentro la scheda del cliente, sezione
 *     `analisi` (lib/agenzia/scheda-cliente.ts): tipo di locale, pubblico, punti di forza, idee.
 *  2. I CANALI — social e scheda Google, letti da n8n dai dati pubblici e mandati a
 *     /api/agenzia/analisi-canali (formato `AnalisiCanaliInArrivo` qui sotto).
 *  3. IL SITO — Google PageSpeed Insights, gratuito, chiamato dal nostro server su richiesta del
 *     titolare, al massimo una volta al giorno per negozio; il risultato si tiene da parte.
 * Tutto si salva in `analisi_negozi` (migrazione 711).
 *
 * Regola d'oro: dove un'analisi non c'è ancora la pagina lo dice, e non inventa numeri. Ogni numero
 * che si mostra ha la sua fonte e la sua data. Mai prezzi: le frasi con un prezzo si scartano.
 */

/* ───────────────────────── 1. L'attività (dalla scheda di n8n) ───────────────────────── */

export type AnalisiAttivita = {
  tipoDiLocale: string | null;
  pubblico: string | null;
  puntiDiForza: string[];
  idee: string[];
  daChiarire: string[];
};

const fraseSenzaPrezzo = (v: unknown, max = 300): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t.length >= 3 && t.length <= max && senzaPrezzo(t) ? t : null;
};

/** La lettura dell'attività fatta da n8n, ripulita; `null` se la scheda non ce l'ha. */
export function analisiDellAttivita(scheda: SchedaCliente | null | undefined): AnalisiAttivita | null {
  const a = scheda?.analisi;
  if (!a) return null;
  const fuori: AnalisiAttivita = {
    tipoDiLocale: fraseSenzaPrezzo(a.tipo_di_locale),
    pubblico: fraseSenzaPrezzo(a.pubblico),
    puntiDiForza: vociSenzaPrezzo(a.punti_di_forza, 6, 240),
    idee: vociSenzaPrezzo(a.idee_contenuti, 6, 240),
    // Le domande per il titolare e i dubbi di n8n diventano una cosa sola: «da chiarire insieme».
    daChiarire: vociSenzaPrezzo([...(a.cosa_chiedere_al_titolare ?? []), ...(a.dubbi ?? [])], 6, 240),
  };
  const vuota = !fuori.tipoDiLocale && !fuori.pubblico && !fuori.puntiDiForza.length && !fuori.idee.length && !fuori.daChiarire.length;
  return vuota ? null : fuori;
}

/* ───────────────────────── 2. I canali (social e Google, da n8n) ───────────────────────── */

export const CANALI_ANALIZZATI = ['instagram', 'facebook', 'tiktok', 'google'] as const;
export type CanaleAnalizzato = (typeof CANALI_ANALIZZATI)[number];

// `non_disponibile` (sessione n8n, 24/11): il canale non si può leggere coi mezzi consentiti — le pagine
// di Meta e Google non si leggono mai in automatico, si usano solo le API ufficiali (TikTok non ne ha,
// Facebook senza la revisione di Meta nemmeno, Google Places aspetta la decisione di Nicola sui costi).
export const STATI_ANALISI_CANALE = ['fatta', 'non_trovato', 'privato', 'non_disponibile', 'errore'] as const;

const fonteHttps = z.string().trim().max(500).refine((v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}, 'la fonte è un indirizzo https');
const intero = z.number().int().min(0).max(100_000_000);
const voci = z.array(z.string().trim().max(240)).max(6);

const AnalisiCanale = z.object({
  stato: z.enum(STATI_ANALISI_CANALE),
  fonte: fonteHttps.nullable().optional(),
  letto_il: z.string().datetime({ offset: true }).optional(),
  numeri: z
    .object({
      follower: intero.optional(),
      post_ultimi_30_giorni: intero.optional(),
      ultimo_post_il: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      valutazione: z.number().min(0).max(5).optional(),
      recensioni: intero.optional(),
    })
    .strict()
    .optional(),
  osservazioni: voci.optional(),
  consigli: voci.optional(),
});
export type AnalisiDiUnCanale = z.infer<typeof AnalisiCanale>;

/** Quello che manda n8n a POST /api/agenzia/analisi-canali (concordato con la sessione n8n). */
export const AnalisiCanaliInArrivo = z.object({
  tipo: z.literal('analisi-canali'),
  origine: z.string().trim().max(40).optional(),
  id_attivita: z.string().uuid('id_attivita non è un id valido'),
  fatta_il: z.string().datetime({ offset: true }),
  canali: z
    .object(Object.fromEntries(CANALI_ANALIZZATI.map((c) => [c, AnalisiCanale.optional()])) as Record<CanaleAnalizzato, z.ZodOptional<typeof AnalisiCanale>>)
    .strict()
    .refine((c) => Object.keys(c).length > 0, 'nessun canale'),
});
export type AnalisiCanali = z.infer<typeof AnalisiCanaliInArrivo>;

/** Legge l'analisi dei canali salvata; se non è nel formato è come se non ci fosse. Le frasi con prezzi si tolgono. */
export function leggiAnalisiCanali(grezza: unknown): AnalisiCanali | null {
  const esito = AnalisiCanaliInArrivo.safeParse(grezza);
  if (!esito.success) return null;
  const canali = Object.fromEntries(
    Object.entries(esito.data.canali).map(([nome, c]) => [
      nome,
      c && { ...c, osservazioni: vociSenzaPrezzo(c.osservazioni, 6, 240), consigli: vociSenzaPrezzo(c.consigli, 6, 240) },
    ]),
  );
  return { ...esito.data, canali };
}

export const NOMI_CANALI_ANALIZZATI: Record<CanaleAnalizzato, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  google: 'Scheda Google Maps',
};

/** I numeri di un canale detti in parole, solo quelli che n8n ha davvero letto. */
export function numeriInParole(n: AnalisiDiUnCanale['numeri']): string[] {
  if (!n) return [];
  const it = (x: number) => x.toLocaleString('it-IT');
  const fuori: string[] = [];
  if (n.follower !== undefined) fuori.push(`${it(n.follower)} ${n.follower === 1 ? 'persona ti segue' : 'persone ti seguono'}`);
  if (n.post_ultimi_30_giorni !== undefined) fuori.push(`${n.post_ultimi_30_giorni} post negli ultimi 30 giorni`);
  if (n.ultimo_post_il) fuori.push(`ultimo post il ${dataItaliana(n.ultimo_post_il)}`);
  if (n.valutazione !== undefined) fuori.push(`${n.valutazione.toLocaleString('it-IT', { maximumFractionDigits: 1 })} stelle su 5`);
  if (n.recensioni !== undefined) fuori.push(`${it(n.recensioni)} ${n.recensioni === 1 ? 'recensione' : 'recensioni'}`);
  return fuori;
}

export const STATO_CANALE_IN_PAROLE: Record<(typeof STATI_ANALISI_CANALE)[number], string> = {
  fatta: 'Analizzato',
  non_trovato: 'Non l’abbiamo trovato: controlla di averlo scritto giusto.',
  privato: 'Il profilo è privato: dai dati pubblici non si legge.',
  non_disponibile: 'Per ora questo canale non lo possiamo leggere in automatico: lo guardiamo insieme a te.',
  errore: 'La lettura non è riuscita: la rifacciamo noi.',
};

/* ───────────────────────── 3. Il sito (Google PageSpeed, gratuito) ───────────────────────── */

export const PAGESPEED = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** L'indirizzo della chiamata: telefono (come lo vede chi cerca), tre categorie. La chiave è facoltativa e gratuita. */
export function indirizzoPageSpeed(sito: string, chiave?: string | null): string {
  const q = new URLSearchParams({ url: sito, strategy: 'mobile', locale: 'it' });
  for (const c of ['performance', 'seo', 'accessibility']) q.append('category', c);
  if (chiave) q.set('key', chiave);
  return `${PAGESPEED}?${q.toString()}`;
}

export type RisultatoSito = {
  url: string;
  fatta_il: string;
  fonte: 'Google PageSpeed Insights';
  /** 0–100, o `null` se Google non l'ha dato. */
  velocita: number | null;
  seo: number | null;
  accessibilita: number | null;
  /** Quanti secondi servono a vedere la parte principale della pagina (LCP), dal telefono. */
  secondiPerVedere: number | null;
  /** Le cose da sistemare, già in parole semplici (al massimo 6). */
  daSistemare: string[];
};

/**
 * Le verifiche di Google che sappiamo dire in parole semplici. Quelle che non sono qui non si
 * mostrano: meglio una frase in meno che una frase tecnica che il titolare non capisce.
 */
const VERIFICHE_IN_PAROLE: Record<string, string> = {
  'document-title': 'La pagina non ha un titolo: su Google compare senza nome.',
  'meta-description': 'Manca la descrizione che Google mostra sotto il nome del sito.',
  'http-status-code': 'La pagina risponde con un errore a Google.',
  'is-crawlable': 'Google non può leggere la pagina: non compare nelle ricerche.',
  'link-text': 'Alcuni collegamenti dicono solo «clicca qui»: a Google non dicono dove portano.',
  'image-alt': 'Alcune immagini non hanno una descrizione: chi non vede e Google non sanno cosa mostrano.',
  'viewport': 'La pagina non è fatta per il telefono.',
  'font-size': 'Dal telefono il testo è troppo piccolo da leggere.',
  'tap-targets': 'Dal telefono alcuni pulsanti sono troppo piccoli o troppo vicini.',
  'color-contrast': 'Alcuni testi hanno poco contrasto con lo sfondo: si leggono male.',
  'uses-optimized-images': 'Le immagini sono più pesanti del necessario: la pagina si apre piano.',
  'modern-image-formats': 'Le immagini si possono salvare in un formato più leggero.',
  'uses-responsive-images': 'Le immagini sono più grandi dello schermo del telefono.',
  'render-blocking-resources': 'Alcuni file bloccano la pagina prima che si veda.',
  'server-response-time': 'Il server del sito risponde lentamente.',
  'unused-javascript': 'Il sito carica codice che non usa: pesa e rallenta.',
  'html-has-lang': 'La pagina non dice in che lingua è scritta.',
  'hreflang': 'Le versioni in altre lingue non sono indicate bene.',
  'canonical': 'Google non sa qual è l’indirizzo giusto della pagina.',
  'robots-txt': 'Il file che guida Google nel sito ha degli errori.',
};

const punteggio = (cat: unknown): number | null => {
  const s = (cat as { score?: unknown } | undefined)?.score;
  return typeof s === 'number' && s >= 0 && s <= 1 ? Math.round(s * 100) : null;
};

/** Riassume la risposta di PageSpeed in quello che il titolare capisce. `null` se la risposta non è di PageSpeed. */
export function riassumiPageSpeed(json: unknown, url: string, adesso: Date): RisultatoSito | null {
  const lh = (json as { lighthouseResult?: { categories?: Record<string, unknown>; audits?: Record<string, unknown> } } | null)?.lighthouseResult;
  if (!lh?.categories) return null;
  const audits = (lh.audits ?? {}) as Record<string, { score?: unknown; numericValue?: unknown }>;
  const lcp = audits['largest-contentful-paint']?.numericValue;
  const daSistemare = Object.entries(VERIFICHE_IN_PAROLE)
    .filter(([id]) => typeof audits[id]?.score === 'number' && (audits[id].score as number) < 0.9)
    .map(([, frase]) => frase)
    .slice(0, 6);
  const fuori: RisultatoSito = {
    url,
    fatta_il: adesso.toISOString(),
    fonte: 'Google PageSpeed Insights',
    velocita: punteggio(lh.categories.performance),
    seo: punteggio(lh.categories.seo),
    accessibilita: punteggio(lh.categories.accessibility),
    secondiPerVedere: typeof lcp === 'number' && lcp >= 0 && lcp < 600_000 ? Math.round(lcp / 100) / 10 : null,
    daSistemare,
  };
  return fuori.velocita === null && fuori.seo === null && fuori.accessibilita === null ? null : fuori;
}

const RisultatoSitoSalvato = z.object({
  url: z.string().regex(/^https:\/\//),
  fatta_il: z.string(),
  fonte: z.literal('Google PageSpeed Insights'),
  velocita: z.number().min(0).max(100).nullable(),
  seo: z.number().min(0).max(100).nullable(),
  accessibilita: z.number().min(0).max(100).nullable(),
  secondiPerVedere: z.number().min(0).nullable(),
  daSistemare: z.array(z.string().max(300)).max(10),
});

export function leggiRisultatoSito(grezzo: unknown): RisultatoSito | null {
  const e = RisultatoSitoSalvato.safeParse(grezzo);
  return e.success ? e.data : null;
}

export type Voto = 'bene' | 'migliorabile' | 'male';
/** Le soglie di Google: 90 e oltre bene, da 50 a 89 migliorabile, sotto 50 male. */
export const votoDi = (p: number): Voto => (p >= 90 ? 'bene' : p >= 50 ? 'migliorabile' : 'male');

export type VoceSito = { titolo: string; punteggio: number; voto: Voto; frase: string };

/** Le tre voci del sito in parole semplici, solo quelle che Google ha misurato. */
export function sitoInParole(r: RisultatoSito): VoceSito[] {
  const voci: VoceSito[] = [];
  if (r.velocita !== null) {
    const v = votoDi(r.velocita);
    const secondi = r.secondiPerVedere !== null ? ` Dal telefono la parte principale si vede in ${r.secondiPerVedere.toLocaleString('it-IT')} secondi.` : '';
    voci.push({ titolo: 'Velocità dal telefono', punteggio: r.velocita, voto: v, frase: `${{ bene: 'Si apre veloce.', migliorabile: 'Si apre, ma potrebbe essere più veloce.', male: 'Si apre lentamente: chi aspetta, spesso se ne va.' }[v]}${secondi}` });
  }
  if (r.seo !== null) {
    const v = votoDi(r.seo);
    voci.push({ titolo: 'Farsi trovare su Google', punteggio: r.seo, voto: v, frase: { bene: 'Le basi per Google ci sono.', migliorabile: 'Le basi ci sono quasi: mancano alcune cose che Google legge.', male: 'Mancano le basi che Google legge per mostrarti.' }[v] });
  }
  if (r.accessibilita !== null) {
    const v = votoDi(r.accessibilita);
    voci.push({ titolo: 'Facile da usare per tutti', punteggio: r.accessibilita, voto: v, frase: { bene: 'Si legge e si usa bene, anche da chi vede poco.', migliorabile: 'Si usa, ma alcune parti si leggono male.', male: 'Molte parti si leggono e si usano male.' }[v] });
  }
  return voci;
}

/**
 * Una volta al giorno per negozio: si rifà solo se l'ultima è di un altro giorno di Piacenza.
 * (Google la dà gratis, ma con un tetto: così non lo consuma un solo negozio.)
 */
export function sitoDaRifare(ultimaIl: string | null | undefined, adesso: Date): boolean {
  if (!ultimaIl) return true;
  const ultima = new Date(ultimaIl);
  if (Number.isNaN(ultima.getTime())) return true;
  return giornoDiPiacenza(ultima) !== giornoDiPiacenza(adesso);
}

/**
 * L'istante in cui comincia il giorno di Piacenza di `adesso` (mezzanotte a Roma, ora solare o legale).
 * Serve al tetto di un tentativo al giorno: un tentativo prima di questo istante è di ieri.
 */
export function inizioDelGiornoDiPiacenza(adesso: Date): string {
  const giorno = giornoDiPiacenza(adesso);
  for (const fuso of ['+01:00', '+02:00']) {
    const mezzanotte = new Date(`${giorno}T00:00:00${fuso}`);
    const minutoPrima = new Date(mezzanotte.getTime() - 60_000);
    if (giornoDiPiacenza(mezzanotte) === giorno && giornoDiPiacenza(minutoPrima) !== giorno) return mezzanotte.toISOString();
  }
  return new Date(`${giorno}T00:00:00+01:00`).toISOString();
}

/* ───────────────────────── in comune ───────────────────────── */

/** «25 novembre 2026» da una data o da un istante, nel giorno di Piacenza. */
export function dataItaliana(quando: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(quando) ? new Date(`${quando}T12:00:00Z`) : new Date(quando);
  if (Number.isNaN(d.getTime())) return quando;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
}
