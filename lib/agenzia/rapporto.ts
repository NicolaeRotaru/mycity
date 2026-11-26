import type { Abbonamento } from './preventivo';
import { senzaPrezzo, type SchedaCliente } from './scheda-cliente';
import type { AnalisiCanali, RisultatoSito } from './analisi';

/**
 * IL RAPPORTO DELL'IMPRENDITORE — 26/11/2026.
 *
 * Nicola, 26/11 verso le 14:45: l'analisi di ogni attività che si iscrive diventa molto più ricca (12 parti),
 * e il preventivo dice quali parti dà ogni abbonamento. Le sue scelte:
 *  · prima di pagare il titolare vede UN ASSAGGIO: 3-4 numeri veri e leciti (concorrenti vicini, velocità del sito,
 *    follower, ricerche) col riquadro ufficiale di Google accanto, e l'elenco di cosa c'è nel rapporto in ogni
 *    abbonamento (`assaggio`, `ANALISI_PER_FASCIA`);
 *  · il rapporto intero (12 parti) arriva dopo il pagamento: prima, il server non lo manda nemmeno
 *    (`analisiPerChiNonHaPagato`, usata da lib/agenzia/scheda-dopo-abbonamento.ts);
 *  · prezzi invariati (300, 500, 999 € al mese). Base: mai il confronto mese su mese; Business: ogni mese;
 *    Premium: ogni settimana, con un incontro al mese;
 *  · fonti approvate: OpenStreetMap (concorrenti vicini), Google PageSpeed (sito), Instagram, DataForSEO (ricerche,
 *    posizione su Google, temi delle recensioni). Finché le chiavi non ci sono il sito dice «non ancora letto»,
 *    mai uno zero.
 *
 * GOOGLE (parere legale del 26/11, termini EEA di Google Maps in vigore dall'8/7/2025): voto, numero di
 * recensioni, orari, recensioni, nome e indirizzo di Google NON si salvano, nemmeno per poco, e non si copiano nel
 * preventivo, nel rapporto, in email o in PDF. Si tiene solo il `place_id`, e la scheda Google si mostra solo col
 * riquadro ufficiale di Google (Places UI Kit, components/seller/SchedaGoogleUfficiale.tsx), caricato in diretta
 * nel browser. Quindi qui `google` non è una fonte: un pezzo che dice di venire da Google si scarta. TripAdvisor
 * resta spento: nemmeno lui è una fonte, e un blocco che arriva `spento` non si mostra.
 * Accanto a ogni dato: fonte e data («Fonte: OpenStreetMap, letto il 26/11»).
 *
 * DA DOVE ARRIVA. Lo scrive il flusso 16 di n8n dentro la scheda del cliente (POST /api/agenzia/scheda-cliente),
 * in `analisi.fatti` (i numeri) e `analisi.rapporto` (le 12 parti). La forma qui sotto è la BOZZA del piano
 * dell'AD: il contratto lo chiude la sessione dei flussi (N8N/flussi/16-nuovo-cliente-da-mycity/CONTRATTO-RAPPORTO.md).
 * Quando arriva, si allinea qui, in un posto solo. La lettura è indulgente: un pezzo storto si scarta da solo,
 * il resto del rapporto si mostra lo stesso.
 *
 * Regole che non si toccano: mai testi, nomi o foto di chi scrive le recensioni (la reputazione arriva solo per
 * temi citati da almeno 3 recensioni), mai
 * prezzi, telefoni, email o indirizzi web nelle frasi, mai dati personali del titolare.
 */

/*
 * ───────────────────────── le 12 parti ─────────────────────────
 * Erano 11 nel piano; la 12, «I concorrenti sui social e sul web» (cosa pubblicano, quanto, cosa funziona, e le
 * idee di contenuti che ne nascono), l'ha voluta Nicola il 26/11 alle 14:35: «importantissima».
 */

export const PARTI_RAPPORTO = [
  'identita_online',
  'reputazione',
  'concorrenti',
  'zona',
  'ricerche',
  'sito',
  'social',
  'calendario',
  'bandi',
  'mycity',
  'piano_30_giorni',
  'concorrenti_web',
] as const;
export type ParteRapporto = (typeof PARTI_RAPPORTO)[number];

export const TITOLI_PARTI: Record<ParteRapporto, string> = {
  identita_online: 'Come ti trovano online',
  reputazione: 'Cosa dicono di te, per temi',
  concorrenti: 'I concorrenti vicini',
  zona: 'La tua zona',
  ricerche: 'Cosa cercano le persone',
  sito: 'Il tuo sito',
  social: 'I tuoi social',
  calendario: 'Il calendario della città: eventi e meteo',
  bandi: 'Bandi e contributi',
  mycity: 'Il tuo negozio su MyCity',
  piano_30_giorni: 'Il piano dei prossimi 30 giorni',
  concorrenti_web: 'I concorrenti sui social e sul web',
};

/* ───────────────────────── le fonti ───────────────────────── */

export const FONTI_RAPPORTO = [
  'openstreetmap',
  'dataforseo',
  'pagespeed',
  'instagram',
  'facebook',
  'tiktok',
  'mycity',
  'meteo',
  'comune',
  'bandi',
  'web',
] as const;
export type FonteRapporto = (typeof FONTI_RAPPORTO)[number];

export const NOMI_FONTI: Record<FonteRapporto, string> = {
  openstreetmap: 'OpenStreetMap',
  dataforseo: 'DataForSEO',
  pagespeed: 'Google PageSpeed',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  mycity: 'MyCity',
  meteo: 'previsioni meteo',
  comune: 'sito del Comune',
  bandi: 'bandi pubblici',
  web: 'fonti pubbliche',
};

const GIORNO_MS = 24 * 60 * 60 * 1000;

/**
 * Vero se la data di lettura si può dire: una data che non si legge, o nel futuro oltre un giorno (orologio
 * storto), no. Senza la data non si può scrivere «letto il», e un dato senza data non si mostra.
 */
export function dataDiLetturaValida(lettoIl: string | null | undefined, adesso: Date): lettoIl is string {
  if (!lettoIl) return false;
  const t = Date.parse(lettoIl);
  return !Number.isNaN(t) && t <= adesso.getTime() + GIORNO_MS;
}

/** «26/11», nel giorno di Piacenza. */
export function giornoEMese(quando: string): string {
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' });
}

/** «Fonte: OpenStreetMap, letto il 26/11». */
export function etichettaFonte(fonte: FonteRapporto, lettoIl: string): string {
  return `Fonte: ${NOMI_FONTI[fonte]}, letto il ${giornoEMese(lettoIl)}`;
}

/* ───────────────────────── le regole sulle frasi ───────────────────────── */

const CONTATTO = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d\s./()-]{7,}\d/;
/** Come in analisi.ts (mycity#335): gli indirizzi web stanno solo nella fonte, mai nella frase. */
const INDIRIZZO_WEB = /https?:\/\/|www\.|\b[\w-]+\.(?:it|com|net|org|eu|info|biz|io|app|xyz|ly|to|me)(?:\/|\b)/i;
/** Un voto («4,6 su 5», «4.5 stelle») non è un prezzo. */
const VOTO = /\d[.,]\d\s*(su\s*5|\/\s*5|stell[ae])/gi;
const NOME_E_COGNOME = /\b[A-ZÀ-Ý][a-zà-ÿ']+\s+[A-ZÀ-Ý][a-zà-ÿ']+/;
/** «@nome»: nel rapporto non si citano persone né profili altrui (chi recensisce, chi commenta). */
const MENZIONE = /(^|\s)@[\w.]{2,}/;

/** Una frase che si può mostrare, ripulita; `null` se ha un prezzo, un contatto, un link o una menzione. */
export function fraseMostrabile(v: unknown, min = 10, max = 300): string | null {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length < min || t.length > max) return null;
  if (!senzaPrezzo(t.replace(VOTO, 'voto'))) return null;
  if (CONTATTO.test(t) || INDIRIZZO_WEB.test(t) || MENZIONE.test(t)) return null;
  return t;
}

const fonteDi = (v: unknown): FonteRapporto | null => ((FONTI_RAPPORTO as readonly unknown[]).includes(v) ? (v as FonteRapporto) : null);
const numeroFinito = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000_000 ? v : null);
const comeOggetto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/* ───────────────────────── i fatti (i numeri) ───────────────────────── */

export const CHIAVI_FATTI = [
  'concorrenti_vicini',
  'follower_instagram',
  'follower_facebook',
  'follower_tiktok',
  'velocita_sito',
  'ricerche_al_mese',
  'posizione_su_google',
] as const;
export type ChiaveFatto = (typeof CHIAVI_FATTI)[number];

export type Fatto = { valore: number; fonte: FonteRapporto; letto_il: string };

/** I limiti di ogni numero: fuori, il fatto è storto e non si mostra. */
const LIMITI: Record<ChiaveFatto, [number, number]> = {
  concorrenti_vicini: [0, 10_000],
  follower_instagram: [0, 100_000_000],
  follower_facebook: [0, 100_000_000],
  follower_tiktok: [0, 100_000_000],
  velocita_sito: [0, 100],
  ricerche_al_mese: [0, 100_000_000],
  // Il posto fra i risultati di Google per la ricerca principale, letto da DataForSEO: 1 = primo.
  posizione_su_google: [1, 100],
};

/** Il fatto deve venire dalla sua fonte: un numero di concorrenti che dice di venire da Instagram è storto. */
const FONTE_DEL_FATTO: Record<ChiaveFatto, readonly FonteRapporto[]> = {
  concorrenti_vicini: ['openstreetmap'],
  follower_instagram: ['instagram'],
  follower_facebook: ['facebook'],
  follower_tiktok: ['tiktok'],
  velocita_sito: ['pagespeed'],
  ricerche_al_mese: ['dataforseo'],
  posizione_su_google: ['dataforseo'],
};

/** I fatti della scheda che si possono mostrare: col numero nei limiti, la sua fonte, la data valida, non spenti. */
export function leggiFatti(grezzi: unknown, adesso: Date): Partial<Record<ChiaveFatto, Fatto>> {
  const g = comeOggetto(grezzi);
  if (!g) return {};
  const fuori: Partial<Record<ChiaveFatto, Fatto>> = {};
  for (const chiave of CHIAVI_FATTI) {
    const f = comeOggetto(g[chiave]);
    const valore = numeroFinito(f?.valore);
    const fonte = fonteDi(f?.fonte);
    const letto = typeof f?.letto_il === 'string' ? f.letto_il : null;
    if (valore === null || !fonte || !letto) continue;
    const [min, max] = LIMITI[chiave];
    if (valore < min || valore > max) continue;
    if (!FONTE_DEL_FATTO[chiave].includes(fonte)) continue;
    if (f?.spento === true || !dataDiLetturaValida(letto, adesso)) continue;
    fuori[chiave] = { valore, fonte, letto_il: letto };
  }
  return fuori;
}

/* ───────────────────────── l'assaggio, prima di pagare ───────────────────────── */

export type NumeroAssaggio = {
  id: 'concorrenti' | 'velocita_sito' | 'follower' | 'ricerche';
  titolo: string;
  /** Il numero detto in parole; `null` = «non ancora letto». */
  valore: string | null;
  /** «Fonte: OpenStreetMap, letto il 26/11»; `null` quando il valore manca. */
  fonte: string | null;
};

export const NON_ANCORA_LETTO = 'non ancora letto';

const it = (n: number, cifre = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: cifre });
type Valore = { valore: string | null; fonte: string | null };
const VUOTO: Valore = { valore: null, fonte: null };
const conFonte = (valore: string, fonte: FonteRapporto, letto: string): Valore => ({ valore, fonte: etichettaFonte(fonte, letto) });

/**
 * I 4 numeri veri dell'assaggio, solo da fonti lecite (parere legale del 26/11): concorrenti vicini
 * (OpenStreetMap), velocità del sito (PageSpeed), follower Instagram, ricerche e posizione su Google (DataForSEO,
 * se acceso). Accanto, la scheda Google nel riquadro ufficiale di Google: qui nessun numero di Google.
 * Prima i fatti del rapporto; se mancano, quello che il sito sa già (Instagram letto da n8n, il sito misurato da
 * PageSpeed). Uno zero non si mostra mai (Nicola: «mai uno zero»): si dice «non ancora letto».
 */
export function assaggio(
  d: { scheda?: SchedaCliente | null; canali?: AnalisiCanali | null; sito?: RisultatoSito | null },
  adesso: Date,
): NumeroAssaggio[] {
  const fatti = leggiFatti((d.scheda?.analisi as Record<string, unknown> | undefined)?.fatti, adesso);

  const fc = fatti.concorrenti_vicini;
  const concorrenti = fc && fc.valore > 0 ? conFonte(`${it(fc.valore)} ${fc.valore === 1 ? 'attività simile' : 'attività simili'} vicino a te`, fc.fonte, fc.letto_il) : VUOTO;

  let velocita = VUOTO;
  const fs = fatti.velocita_sito;
  if (fs && fs.valore > 0) velocita = conFonte(`${it(fs.valore)} su 100`, fs.fonte, fs.letto_il);
  else if (d.sito?.velocita && dataDiLetturaValida(d.sito.fatta_il, adesso)) velocita = conFonte(`${it(d.sito.velocita)} su 100`, 'pagespeed', d.sito.fatta_il);

  let follower = VUOTO;
  const ff = fatti.follower_instagram;
  if (ff && ff.valore > 0) follower = conFonte(`${it(ff.valore)} su Instagram`, ff.fonte, ff.letto_il);
  else {
    const ig = d.canali?.canali.instagram;
    const letto = ig?.letto_il ?? d.canali?.fatta_il ?? null;
    const n = ig?.stato === 'fatta' ? ig.numeri?.follower : undefined;
    if (n && n > 0 && dataDiLetturaValida(letto, adesso)) follower = conFonte(`${it(n)} su Instagram`, 'instagram', letto);
  }

  const fr = fatti.ricerche_al_mese;
  const fp = fatti.posizione_su_google;
  const parti = [fr && fr.valore > 0 ? `${it(fr.valore)} al mese` : null, fp ? `sei ${it(fp.valore)}° su Google` : null].filter(Boolean);
  const primo = fr && fr.valore > 0 ? fr : fp;
  const ricerche = parti.length && primo ? conFonte(parti.join(', '), primo.fonte, primo.letto_il) : VUOTO;

  return [
    { id: 'concorrenti', titolo: 'Concorrenti vicini', ...concorrenti },
    { id: 'velocita_sito', titolo: 'Velocità del tuo sito', ...velocita },
    { id: 'follower', titolo: 'Chi ti segue', ...follower },
    { id: 'ricerche', titolo: 'Chi ti cerca su Google', ...ricerche },
  ];
}

/**
 * Il `place_id` della scheda Google (l'unico dato di Google che si tiene), in `analisi.google.place_id`. La forma
 * esatta della busta `google` la conferma la sessione dei flussi. `null` se manca o è storto.
 */
export function placeIdDi(scheda: SchedaCliente | null | undefined): string | null {
  const g = comeOggetto((scheda?.analisi as Record<string, unknown> | undefined)?.google);
  const id = typeof g?.place_id === 'string' ? g.place_id.trim() : '';
  return /^[A-Za-z0-9_-]{10,300}$/.test(id) ? id : null;
}

/* ───────────────────────── le 12 parti, dopo il pagamento ───────────────────────── */

export type VoceRapporto = { titolo: string; dettaglio: string | null; numero: number | null; fonte: string };
export type TemaReputazione = { tema: string; tono: 'positivo' | 'negativo' | 'misto'; quante: number };
export type Parte = {
  /** «Fonte: Google, letto il 26/11». */
  fonte: string;
  frasi: string[];
  voci: VoceRapporto[];
  temi: TemaReputazione[];
};
/** Per ogni parte: il contenuto, o `null` (non ancora letta, spenta, o da una fonte non ammessa). */
export type Rapporto = Record<ParteRapporto, Parte | null>;
/** Una voce di reputazione si mostra solo se il tema lo citano almeno 3 recensioni (parere legale del 26/11). */
export const RECENSIONI_MINIME_PER_TEMA = 3;

const MAX_FRASI = 5;
const MAX_VOCI = 8;
const MAX_TEMI = 8;

function leggiParte(nome: ParteRapporto, grezza: unknown, adesso: Date): Parte | null {
  const p = comeOggetto(grezza);
  if (!p || p.spento === true || p.stato === 'spento') return null;
  const fonte = fonteDi(p.fonte);
  const letto = typeof p.letto_il === 'string' ? p.letto_il : null;
  if (!fonte || !dataDiLetturaValida(letto, adesso)) return null;

  const frasi = (Array.isArray(p.frasi) ? p.frasi : []).map((f) => fraseMostrabile(f)).filter((f): f is string => !!f).slice(0, MAX_FRASI);

  // La reputazione arriva SOLO per temi: niente frasi né voci libere, dove potrebbe finire il testo o il nome di
  // chi ha scritto. Nei concorrenti niente numeri: né voti né classifiche (parere legale del 26/11).
  if (nome === 'reputazione') frasi.length = 0;
  const voci: VoceRapporto[] =
    nome === 'reputazione'
      ? []
      : (Array.isArray(p.voci) ? p.voci : [])
          .map((v): VoceRapporto | null => {
            const o = comeOggetto(v);
            const titolo = fraseMostrabile(o?.titolo, 2, 80);
            if (!o || !titolo) return null;
            // Una voce può avere la sua fonte e la sua data (un evento dal sito del Comune dentro il calendario).
            // Una fonte scritta ma non ammessa (Google, TripAdvisor) scarta la voce: non si eredita quella della parte.
            if (o.fonte !== undefined && !fonteDi(o.fonte)) return null;
            const fv = fonteDi(o.fonte) ?? fonte;
            const lv = typeof o.letto_il === 'string' ? o.letto_il : letto;
            if (!dataDiLetturaValida(lv, adesso)) return null;
            const dettaglio = o.dettaglio === undefined || o.dettaglio === null ? null : fraseMostrabile(o.dettaglio, 3, 160);
            if (o.dettaglio && !dettaglio) return null;
            return { titolo, dettaglio, numero: nome === 'concorrenti' ? null : numeroFinito(o.numero), fonte: etichettaFonte(fv, lv) };
          })
          .filter((v): v is VoceRapporto => !!v)
          .slice(0, MAX_VOCI);

  const temi: TemaReputazione[] =
    nome !== 'reputazione'
      ? []
      : (Array.isArray(p.temi) ? p.temi : [])
          .map((t): TemaReputazione | null => {
            const o = comeOggetto(t);
            const tema = fraseMostrabile(o?.tema, 2, 40);
            // Un tema è una cosa («i dolci», «il servizio»), mai una persona: due parole di fila con la maiuscola
            // («Mario Rossi») sono quasi sempre un nome, e il tema si scarta.
            if (tema && NOME_E_COGNOME.test(tema)) return null;
            const tono = o?.tono === 'positivo' || o?.tono === 'negativo' || o?.tono === 'misto' ? o.tono : null;
            if (!tema || !tono) return null;
            const q = numeroFinito(o?.quante);
            if (q === null || !Number.isInteger(q) || q < RECENSIONI_MINIME_PER_TEMA) return null;
            return { tema, tono, quante: q };
          })
          .filter((t): t is TemaReputazione => !!t)
          .slice(0, MAX_TEMI);

  if (!frasi.length && !voci.length && !temi.length) return null;
  return { fonte: etichettaFonte(fonte, letto), frasi, voci, temi };
}

/** Il rapporto della scheda, parte per parte; `null` se non c'è proprio. */
export function leggiRapporto(scheda: SchedaCliente | null | undefined, adesso: Date): Rapporto | null {
  const r = comeOggetto((scheda?.analisi as Record<string, unknown> | undefined)?.rapporto);
  const parti = comeOggetto(r?.parti);
  if (!parti) return null;
  const fuori = Object.fromEntries(PARTI_RAPPORTO.map((nome) => [nome, leggiParte(nome, parti[nome], adesso)])) as Rapporto;
  return PARTI_RAPPORTO.some((n) => fuori[n] !== null) ? fuori : null;
}

/**
 * L'analisi come la riceve chi non ha ancora pagato: senza il rapporto, e dei fatti solo quelli dell'assaggio.
 * Così il rapporto intero non esce dal server prima del pagamento, nemmeno nella risposta che il browser riceve.
 */
const FATTI_DELL_ASSAGGIO: readonly ChiaveFatto[] = ['concorrenti_vicini', 'velocita_sito', 'follower_instagram', 'ricerche_al_mese', 'posizione_su_google'];
export function analisiPerChiNonHaPagato<T extends Record<string, unknown> | undefined>(analisi: T): T {
  if (!analisi) return analisi;
  const { rapporto: _rapporto, fatti, ...resto } = analisi as Record<string, unknown>;
  const f = comeOggetto(fatti);
  const soloAssaggio = f ? Object.fromEntries(FATTI_DELL_ASSAGGIO.filter((k) => k in f).map((k) => [k, f[k]])) : undefined;
  // Della busta `google` passa solo il place_id: serve al riquadro ufficiale accanto all'assaggio.
  const g = comeOggetto(resto.google);
  delete resto.google;
  const placeId = typeof g?.place_id === 'string' ? g.place_id : null;
  return { ...resto, ...(soloAssaggio ? { fatti: soloAssaggio } : {}), ...(placeId ? { google: { place_id: placeId } } : {}) } as T;
}

/* ───────────────────────── il preventivo: cosa c'è nella tua analisi, per abbonamento ───────────────────────── */

/**
 * «COSA C'È NELLA TUA ANALISI» — UNA TABELLA SOLA, come `FASCE` (26/11/2026).
 *
 * Nicola, 14:54: l'analisi si personalizza per abbonamento, come contenuti, foto, video e sito; il preventivo
 * mostra per OGNI fascia quali parti del rapporto ci sono (con la spunta) e quali NO (dette chiaramente).
 * Quanto entra in ogni fascia è una proposta dell'AD che decide Nicola: si cambia qui, e cambiano insieme il
 * preventivo, l'assaggio e il rapporto dopo il pagamento.
 *  · `parti`: per ogni parte, `null` = esclusa; una stringa = inclusa («» se non c'è niente da aggiungere, oppure
 *    come: «sui 3 concorrenti principali»);
 *  · `inPiu`: quello che la fascia dà oltre alle parti (il ritmo degli aggiornamenti, l'incontro);
 *  · `nonComprende`: quello che non dà, oltre alle parti escluse.
 * Regole che le prove controllano: il Base non promette mai il confronto mese su mese né aggiornamenti; il
 * Business non promette la settimana; il testo di `FASCE.*.servizi.analisi` non nomina una parte esclusa.
 */
export type AnalisiDellaFascia = {
  ritmo: string;
  parti: Record<ParteRapporto, string | null>;
  inPiu: string[];
  nonComprende: string[];
};

const AVVISO_BANDI = 'Un avviso quando esce un bando adatto a te.';
const CONFRONTO_GOOGLE = 'Il confronto su Google mese su mese, se ci dai l’accesso al tuo profilo Google Business.';

export const ANALISI_PER_FASCIA: Record<Abbonamento, AnalisiDellaFascia> = {
  base: {
    ritmo: 'Il rapporto completo all’avvio, una volta.',
    parti: {
      identita_online: '',
      reputazione: '',
      concorrenti: '',
      zona: '',
      ricerche: null,
      sito: '',
      social: 'solo i tuoi social',
      calendario: '',
      bandi: '',
      mycity: null,
      piano_30_giorni: '',
      concorrenti_web: null,
    },
    inPiu: [AVVISO_BANDI],
    nonComprende: ['Gli aggiornamenti periodici e il confronto mese su mese: ci sono nel Business e nel Premium.'],
  },
  business: {
    ritmo: 'Il rapporto completo all’avvio, poi aggiornato ogni mese.',
    parti: {
      identita_online: '',
      reputazione: '',
      concorrenti: '',
      zona: '',
      ricerche: '',
      sito: '',
      social: '',
      calendario: 'gli eventi del mese',
      bandi: '',
      mycity: 'le tue vendite, ogni mese',
      piano_30_giorni: 'rifatto ogni mese',
      concorrenti_web: 'sui 3 concorrenti principali',
    },
    inPiu: [
      'Ogni mese, cosa è cambiato: follower, temi delle recensioni, concorrenti.',
      CONFRONTO_GOOGLE,
      AVVISO_BANDI,
    ],
    nonComprende: ['L’aggiornamento ogni settimana e l’incontro al mese: ci sono nel Premium.'],
  },
  premium: {
    ritmo: 'Il rapporto completo all’avvio, poi aggiornato ogni settimana.',
    parti: {
      identita_online: '',
      reputazione: 'i temi delle recensioni nuove, con le risposte pronte da pubblicare',
      concorrenti: '',
      zona: '',
      ricerche: '',
      sito: '',
      social: '',
      calendario: 'eventi e meteo, con le mosse da fare',
      bandi: '',
      mycity: 'le tue vendite, ogni settimana',
      piano_30_giorni: 'aggiornato ogni settimana',
      concorrenti_web: 'fino a 5 concorrenti, coi loro post migliori della settimana e le idee per i tuoi',
    },
    inPiu: ['Ogni settimana, cosa è cambiato.', CONFRONTO_GOOGLE, AVVISO_BANDI, 'Un incontro al mese per leggerlo insieme.'],
    nonComprende: [],
  },
};

export type RigaAnalisi = { parte: ParteRapporto; titolo: string; come: string | null };

/** Le parti incluse e quelle escluse di una fascia, nell'ordine del rapporto, lette dalla tabella. */
export function partiDellaFascia(fascia: Abbonamento): { incluse: RigaAnalisi[]; escluse: RigaAnalisi[] } {
  const righe = PARTI_RAPPORTO.map((parte) => ({ parte, titolo: TITOLI_PARTI[parte], come: ANALISI_PER_FASCIA[fascia].parti[parte] }));
  return {
    incluse: righe.filter((r) => r.come !== null).map((r) => ({ ...r, come: r.come || null })),
    escluse: righe.filter((r) => r.come === null),
  };
}

/* ───────────────────────── prima di salvare: niente dati di Google ───────────────────────── */

/**
 * L'analisi come si salva, quando n8n manda la scheda (POST /api/agenzia/scheda-cliente). Parere legale del 26/11:
 * i dati di Google non si salvano, nemmeno per poco. Quindi, prima di scrivere nel database:
 *  · della busta `google` resta solo il `place_id`;
 *  · dei fatti restano solo quelli noti, con una fonte ammessa (Google e TripAdvisor non lo sono);
 *  · delle parti del rapporto si tolgono quelle, e le voci, che vengono da una fonte non ammessa.
 * Il resto dell'analisi resta com'è arrivato: la lettura vera (`leggiRapporto`) lo ripulisce di nuovo.
 */
export function analisiDaSalvare<T extends Record<string, unknown> | undefined>(analisi: T): T {
  if (!analisi) return analisi;
  const a = { ...(analisi as Record<string, unknown>) };

  if ('google' in a) {
    const g = comeOggetto(a.google);
    const id = typeof g?.place_id === 'string' ? g.place_id.trim().slice(0, 300) : '';
    if (id) a.google = { place_id: id };
    else delete a.google;
  }

  if ('fatti' in a) {
    const f = comeOggetto(a.fatti);
    const tenuti = f
      ? Object.fromEntries(CHIAVI_FATTI.filter((k) => fonteDi(comeOggetto(f[k])?.fonte) && FONTE_DEL_FATTO[k].includes(fonteDi(comeOggetto(f[k])?.fonte)!)).map((k) => [k, f[k]]))
      : {};
    if (Object.keys(tenuti).length) a.fatti = tenuti;
    else delete a.fatti;
  }

  if ('rapporto' in a) {
    const r = comeOggetto(a.rapporto);
    const parti = comeOggetto(r?.parti);
    if (!r || !parti) delete a.rapporto;
    else {
      const pulite = Object.fromEntries(
        PARTI_RAPPORTO.flatMap((nome) => {
          const p = comeOggetto(parti[nome]);
          if (!p || !fonteDi(p.fonte)) return [];
          const voci = Array.isArray(p.voci) ? p.voci.filter((v) => { const o = comeOggetto(v); return !!o && (o.fonte === undefined || !!fonteDi(o.fonte)); }) : undefined;
          return [[nome, { ...p, ...(voci ? { voci } : {}) }]];
        }),
      );
      a.rapporto = { ...r, parti: pulite };
    }
  }
  return a as T;
}
