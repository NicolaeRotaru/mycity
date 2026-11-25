import { z } from 'zod';
import { SERVIZI_AGENZIA, giornoDiPiacenza, type ServizioAgenzia } from './preventivo';
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
  // 25/11/2026 sera — Il giudizio dell'AD sul canale (flusso 16, N8N#16): si legge con indulgenza, un valore
  // storto vale «non detto» e non fa respingere l'analisi intera.
  giudizio: z.unknown().optional().transform((g) => leggiGiudizioCanale(g) ?? undefined),
});
export type AnalisiDiUnCanale = z.infer<typeof AnalisiCanale>;

/**
 * IL GIUDIZIO DELL'AD SU UN CANALE — 25/11/2026 sera (Nicola, `agenzia.social-come-il-sito`).
 * Lo manda il flusso 16 dentro ogni canale di POST /api/agenzia/analisi-canali, nella forma chiusa dall'AD nella
 * N8N#16 (testa 119c57e): `livello` (debole|attivo|forte; il profilo assente è lo stato `non_trovato`), `post_al_mese`,
 * `video` e `risposte_recensioni` (vero, falso o `null` = non saputo), `cura` (curato|datato|fai-da-te),
 * `migliorie` (10-240 caratteri, senza prezzi né telefoni). Unica tabella dei social: `giudizio_social` non c'è più.
 */
export type GiudizioCanale = {
  livello: 'debole' | 'attivo' | 'forte' | null;
  post_al_mese: number | null;
  video: boolean | null;
  cura: 'curato' | 'datato' | 'fai-da-te' | null;
  risposte_recensioni: boolean | null;
  migliorie: string | null;
};

const vf = (v: unknown): boolean | null => (v === true || v === false ? v : null);
const tra = <T extends string>(v: unknown, elenco: readonly T[]): T | null => ((elenco as readonly unknown[]).includes(v) ? (v as T) : null);
const TELEFONO_O_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d\s./()-]{7,}\d/;

/** Il giudizio ripulito: valori fuori elenco = non detto; `null` se non resta niente. */
export function leggiGiudizioCanale(grezzo: unknown): GiudizioCanale | null {
  if (!grezzo || typeof grezzo !== 'object' || Array.isArray(grezzo)) return null;
  const g = grezzo as Record<string, unknown>;
  const post = typeof g.post_al_mese === 'number' && Number.isInteger(g.post_al_mese) && g.post_al_mese >= 0 && g.post_al_mese <= 100_000 ? g.post_al_mese : null;
  const m = typeof g.migliorie === 'string' ? g.migliorie.replace(/\s+/g, ' ').trim() : '';
  const fuori: GiudizioCanale = {
    livello: tra(g.livello, ['debole', 'attivo', 'forte'] as const),
    post_al_mese: post,
    video: vf(g.video),
    cura: tra(g.cura, ['curato', 'datato', 'fai-da-te'] as const),
    risposte_recensioni: vf(g.risposte_recensioni),
    migliorie: m.length >= 10 && m.length <= 240 && senzaPrezzo(m) && !TELEFONO_O_EMAIL.test(m) ? m : null,
  };
  return Object.values(fuori).some((v) => v !== null) ? fuori : null;
}

/**
 * I LIVELLI DEI SOCIAL — Nicola, `agenzia.social-come-il-sito` (25/11/2026), per ogni canale:
 *  · nessuno: il profilo non c'è;
 *  · debole: meno di 8 post al mese;
 *  · attivo: da 8 a 12 post al mese, curato;
 *  · forte: più di 12 post al mese, con video.
 * Il conto dei post viene dal giudizio dell'AD o dai numeri letti; senza conto vale il livello scritto dall'AD.
 * `null`: l'analisi del canale manca, o non dice abbastanza.
 * Dove un dato manca non si promuove: «più di 12 post» senza sapere dei video resta «attivo».
 */
export type LivelloSocial = 'nessuno' | 'debole' | 'attivo' | 'forte';
export function livelloSocial(c: AnalisiDiUnCanale | null | undefined): LivelloSocial | null {
  if (!c) return null;
  if (c.stato === 'non_trovato') return 'nessuno';
  if (c.stato !== 'fatta') return null;
  const g = c.giudizio ?? null;
  const post = g?.post_al_mese ?? c.numeri?.post_ultimi_30_giorni ?? null;
  const conVideo = g?.video === true;
  if (post === null) return g?.livello ?? null;
  if (post < 8) return 'debole';
  if (post > 12 && conVideo) return 'forte';
  return 'attivo';
}

export const LIVELLO_SOCIAL_IN_PAROLE: Record<LivelloSocial, string> = {
  nessuno: 'Il profilo non c’è.',
  debole: 'Oggi pubblica poco, o senza cura.',
  attivo: 'Oggi è attivo e curato.',
  forte: 'Oggi è forte: tanti post al mese, con video.',
};

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

const senzaContatti = (v: string[]) => v.filter((x) => !TELEFONO_O_EMAIL.test(x));

/** Legge l'analisi dei canali salvata; se non è nel formato è come se non ci fosse. Le frasi con prezzi si tolgono. */
export function leggiAnalisiCanali(grezza: unknown): AnalisiCanali | null {
  const esito = AnalisiCanaliInArrivo.safeParse(grezza);
  if (!esito.success) return null;
  const canali = Object.fromEntries(
    Object.entries(esito.data.canali).map(([nome, c]) => [
      nome,
      // 25/11/2026 sera — I canali vanno anche nel link pubblico: oltre ai prezzi si tolgono telefoni ed email (dal collaudo).
      c && { ...c, osservazioni: senzaContatti(vociSenzaPrezzo(c.osservazioni, 6, 240)), consigli: senzaContatti(vociSenzaPrezzo(c.consigli, 6, 240)) },
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

/* ───────────── 4. L'analisi del business, come l'AD analizza MyCity come azienda (25/11/2026) ───────────── */

/**
 * Nicola, 25/11 alle 17:55: «vorrei che li fai il preventivo anche sulla parte di analisi sul suo business come
 * fa AD su MyCity (non MyCity marketplace ma azienda)». La scrive l'AD col piano Max nel flusso 16 di n8n
 * («Chiedi all'AD»), dalle sole fonti pubbliche e gratuite, e arriva dentro la scheda: `analisi.business`.
 * È analisi, quindi vale subito, anche in demo. Ogni frase ha la sua fonte: una frase senza fonte https, con
 * un prezzo, un telefono o un'email non si mostra.
 */
export const SEZIONI_BUSINESS = ['situazione', 'mercato', 'clienti', 'opportunita', 'rischi', 'prime_mosse'] as const;
export type SezioneBusiness = (typeof SEZIONI_BUSINESS)[number];
export const TITOLI_BUSINESS: Record<SezioneBusiness, string> = {
  situazione: 'Com’è messa oggi',
  mercato: 'Il mercato e i concorrenti vicini',
  clienti: 'I clienti e la reputazione',
  opportunita: 'Le opportunità',
  rischi: 'I rischi',
  prime_mosse: 'Le prime mosse',
};
/**
 * 25/11/2026 — Nelle opportunità e nelle prime mosse l'AD può legare la frase a un nostro servizio (`servizio`:
 * foto_video, sito_web, social, analisi) e dire in una frase cosa facciamo (`proposta`, 10-160 caratteri, senza
 * prezzi né contatti): allora diventa una proposta dell'offerta su misura (lib/agenzia/offerta-su-misura.ts).
 */
export type FraseConFonte = { testo: string; fonte: string; servizio?: ServizioAgenzia; proposta?: string };
export type AnalisiAziendale = Record<SezioneBusiness, FraseConFonte[]>;

const CONTATTO = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s.-]{7,}\d/;
/** Un voto («4,6 su 5», «4.5 stelle») non è un prezzo: si toglie prima del controllo dei prezzi. */
const VOTO = /\d[.,]\d\s*(su\s*5|\/\s*5|stell[ae])/gi;

/** L'analisi del business della scheda, ripulita; `null` se non c'è o se nessuna frase regge. */
export function analisiAziendale(scheda: SchedaCliente | null | undefined): AnalisiAziendale | null {
  const grezza = (scheda?.analisi as Record<string, unknown> | undefined)?.business;
  if (!grezza || typeof grezza !== 'object') return null;
  let quante = 0;
  const fuori = Object.fromEntries(
    SEZIONI_BUSINESS.map((s) => {
      const voci = Array.isArray((grezza as Record<string, unknown>)[s]) ? ((grezza as Record<string, unknown>)[s] as unknown[]) : [];
      const pulite = voci
        .map((v) => {
          const frase: FraseConFonte = {
            testo: typeof (v as FraseConFonte)?.testo === 'string' ? (v as FraseConFonte).testo.replace(/\s+/g, ' ').trim() : '',
            fonte: typeof (v as FraseConFonte)?.fonte === 'string' ? (v as FraseConFonte).fonte.trim() : '',
          };
          const servizio = (v as Record<string, unknown>)?.servizio;
          const proposta = typeof (v as Record<string, unknown>)?.proposta === 'string' ? String((v as Record<string, unknown>).proposta).replace(/\s+/g, ' ').trim() : '';
          const propostaPulita = proposta.length >= 10 && proposta.length <= 160 && senzaPrezzo(proposta) && !CONTATTO.test(proposta);
          if ((s === 'opportunita' || s === 'prime_mosse') && (SERVIZI_AGENZIA as readonly unknown[]).includes(servizio) && propostaPulita) {
            frase.servizio = servizio as ServizioAgenzia;
            frase.proposta = proposta;
          }
          return frase;
        })
        .filter((v) => v.testo.length >= 10 && v.testo.length <= 300 && senzaPrezzo(v.testo.replace(VOTO, 'voto')) && !CONTATTO.test(v.testo) && fonteHttps.safeParse(v.fonte).success)
        .slice(0, 3);
      quante += pulite.length;
      return [s, pulite];
    }),
  ) as AnalisiAziendale;
  return quante ? fuori : null;
}

/**
 * I TRE STATI DELL'ANALISI DEL BUSINESS — 25/11/2026 sera.
 *  · `fatta`: c'è almeno una frase con la sua fonte;
 *  · `senza_fonti`: l'AD l'ha fatta (`analisi.business_fatta_il`, N8N#16) ma in rete non ha trovato niente da citare;
 *  · `da_fare`: non è ancora arrivata.
 * Senza il secondo stato, per un locale senza fonti (La Ragazzetta) il link diceva per sempre «la stiamo preparando».
 */
export type StatoAnalisiBusiness = 'fatta' | 'senza_fonti' | 'da_fare';
export function statoAnalisiBusiness(scheda: SchedaCliente | null | undefined): StatoAnalisiBusiness {
  if (analisiAziendale(scheda)) return 'fatta';
  const il = (scheda?.analisi as Record<string, unknown> | undefined)?.business_fatta_il;
  return typeof il === 'string' && !Number.isNaN(Date.parse(il)) ? 'senza_fonti' : 'da_fare';
}
export const ANALISI_SENZA_FONTI = 'In rete non abbiamo trovato informazioni pubbliche sul tuo locale: la facciamo con te al primo incontro.';

/** Il giudizio dell'AD su un canale in parole, per la pagina «Analisi»: il livello, i video, le risposte. Vuoto senza analisi. */
export function giudizioCanaleInParole(c: AnalisiDiUnCanale | null | undefined, canale: CanaleAnalizzato): string[] {
  if (!c || c.stato !== 'fatta') return [];
  const g = c.giudizio;
  const livello = canale === 'google' ? null : livelloSocial(c);
  return [
    livello && livello !== 'nessuno' ? LIVELLO_SOCIAL_IN_PAROLE[livello] : null,
    canale !== 'google' && g?.video !== null && g?.video !== undefined ? (g.video ? 'Usa i video.' : 'Non usa i video.') : null,
    g?.risposte_recensioni !== null && g?.risposte_recensioni !== undefined ? (g.risposte_recensioni ? 'Risponde alle recensioni.' : 'Non risponde alle recensioni.') : null,
  ].filter((x): x is string => !!x);
}
