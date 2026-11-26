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
 *    posizione su Google, temi delle recensioni), MET Norway e le fonti pubbliche per eventi e bandi. Finché le
 *    chiavi non ci sono il sito dice «non ancora letto» o «in arrivo», mai uno zero inventato.
 *
 * GOOGLE (parere legale del 26/11, termini EEA di Google Maps in vigore dall'8/7/2025): voto, numero di
 * recensioni, orari, recensioni, nome e indirizzo di Google NON si salvano, nemmeno per poco, e non si copiano nel
 * preventivo, nel rapporto, in email o in PDF. Si tiene solo il `place_id`, e la scheda Google si mostra solo col
 * riquadro ufficiale di Google (Places UI Kit, components/seller/SchedaGoogleUfficiale.tsx), caricato in diretta
 * nel browser. I blocchi `google`, `tripadvisor` e `recensioni` non si mostrano mai; un nome di fonte che dice
 * Google o TripAdvisor accanto a un numero si scarta. Accanto a ogni dato: fonte, data e licenza
 * («Fonte: OpenStreetMap, letto il 26/11, licenza ODbL»).
 *
 * DA DOVE ARRIVA (contratto v1.2 della sessione dei flussi, N8N flussi/16-nuovo-cliente-da-mycity/CONTRATTO-RAPPORTO.md):
 * dentro la scheda che il flusso manda già (POST /api/agenzia/scheda-cliente), in `analisi.fatti` (i blocchi dei
 * numeri, ognuno con stato, fonte, licenza e data) e in `analisi.business` (le sezioni nuove dell'AD accanto a
 * quelle di prima). La lettura è indulgente: un pezzo storto si scarta da solo, il resto si mostra lo stesso.
 *
 * Regole che non si toccano: mai testi, nomi o foto di chi scrive le recensioni (la reputazione arriva solo per
 * temi citati da almeno 3 recensioni), mai prezzi, telefoni, email o indirizzi web nelle frasi, mai dati
 * personali del titolare. Niente si cancella (regola di Nicola del 26/11, ore 15): un dato scaduto si nasconde.
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
  identita_online: 'La tua carta d’identità online',
  reputazione: 'La tua reputazione',
  concorrenti: 'I concorrenti vicini',
  zona: 'La tua zona',
  ricerche: 'Cosa cerca la gente',
  sito: 'Il tuo sito',
  social: 'I tuoi social',
  calendario: 'Il calendario della città',
  bandi: 'Soldi pubblici',
  mycity: 'Su MyCity',
  piano_30_giorni: 'Il piano dei 30 giorni',
  concorrenti_web: 'I concorrenti sui social e sul web',
};

/* ───────────────────────── le regole sulle frasi ───────────────────────── */

const CONTATTO = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d\s./()-]{7,}\d/;
/** Come in analisi.ts (mycity#335): gli indirizzi web stanno solo nella fonte, mai nella frase. */
const INDIRIZZO_WEB = /https?:\/\/|www\.|\b[\w-]+\.(?:it|com|net|org|eu|info|biz|io|app|xyz|ly|to|me)(?:\/|\b)/i;
/** Un voto («4,6 su 5», «4.5 stelle») non è un prezzo. */
const VOTO = /\d[.,]\d\s*(su\s*5|\/\s*5|stell[ae])/gi;
/** Due parole di fila con la maiuscola («Mario Rossi»): quasi sempre un nome di persona. */
const NOME_E_COGNOME = /\b[A-ZÀ-Ý][a-zà-ÿ']+\s+[A-ZÀ-Ý][a-zà-ÿ']+/;
/** «@nome», anche fra parentesi: nel rapporto non si citano persone né profili altrui (chi recensisce, chi commenta). */
const MENZIONE = /@[\w.]{2,}/;
/**
 * Un voto o un conto di recensioni ricopiato da Google o TripAdvisor («4,6 su Google», «120 recensioni»,
 * «quattro e mezzo su cinque»): non è un nostro dato e non si mostra (parere legale del 26/11).
 */
const NUMERO_DI_GOOGLE = /(google|maps|tripadvisor)[^.]*(\d|stell|voto|recension)|\d[^.]*(google|maps|tripadvisor|recension|stell)|su cinque\b|stelle\b/i;
/** Un prezzo detto senza moneta («25 a persona», «coperto 3»): `senzaPrezzo` guarda la moneta e i decimali. */
const PREZZO_SENZA_MONETA = /\d+\s*(a persona|a testa|cad\.?|al pezzo|al chilo|al kg)\b|\bcoperto\s*\d/i;

/** Una frase che si può mostrare, ripulita; `null` se ha un prezzo, un contatto, un link, una menzione o un numero di Google. */
export function fraseMostrabile(v: unknown, min = 10, max = 300): string | null {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length < min || t.length > max) return null;
  if (!senzaPrezzo(t.replace(VOTO, 'voto'))) return null;
  if (CONTATTO.test(t) || INDIRIZZO_WEB.test(t) || MENZIONE.test(t) || NUMERO_DI_GOOGLE.test(t) || PREZZO_SENZA_MONETA.test(t)) return null;
  return t;
}

const comeOggetto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const intero = (v: unknown, max = 100_000_000): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const elenco = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const https = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
};

/* ───────────────────────── le fonti e le date ───────────────────────── */

const GIORNO_MS = 24 * 60 * 60 * 1000;

/** Vero se la data di lettura si può dire: una data che non si legge, o nel futuro oltre un giorno (orologio storto), no. */
/** Oltre un anno un dato non dice più com'è oggi l'attività (e «letto il 01/01» senza anno ingannerebbe). */
const ETA_MASSIMA_MS = 365 * GIORNO_MS;
export function dataDiLetturaValida(lettoIl: unknown, adesso: Date): lettoIl is string {
  if (typeof lettoIl !== 'string') return false;
  const t = Date.parse(lettoIl);
  return !Number.isNaN(t) && t <= adesso.getTime() + GIORNO_MS && adesso.getTime() - t <= ETA_MASSIMA_MS;
}

/** «26/11», nel giorno di Piacenza. */
export function giornoEMese(quando: string): string {
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' });
}

/**
 * I blocchi dei fatti che il sito non mostra MAI (parere legale del 26/11): `google` porta solo il place_id (che va
 * al riquadro ufficiale), `tripadvisor` è spento, `recensioni` arriva al sito solo come temi (`reputazione_temi`).
 */
const BLOCCHI_MAI_MOSTRATI = new Set(['google', 'tripadvisor', 'recensioni']);
/** Un nome di fonte che dice Google (tranne PageSpeed, la misura del sito) o TripAdvisor non si scrive accanto a un dato. */
const FONTE_VIETATA = /tripadvisor|google(?!\s*pagespeed)/i;

/** «Fonte: OpenStreetMap, letto il 26/11, licenza ODbL». */
export function etichettaFonte(fonteNome: string, lettoIl: string, licenza?: string | null): string {
  return `Fonte: ${fonteNome}, letto il ${giornoEMese(lettoIl)}${licenza ? `, licenza ${licenza}` : ''}`;
}

/**
 * UN BLOCCO DEI FATTI (contratto v1.2, sez. 1): { stato, motivo, fonte, fonte_nome, licenza, letto_il,
 * conserva_fino_al, dati, parte }. Si mostra solo se `letto` o `vuoto` (vuoto = contato, ed è zero), con un nome di
 * fonte ammesso e la data. `spento` non si mostra mai come «non trovato» (regola 7). Passata `conserva_fino_al`
 * (DataForSEO) i dati non si mostrano più: «da rileggere» (sez. 3). Il campo `parte` del contratto è provvisorio e
 * si ignora: la parte la decide la chiave del blocco (`PARTE_DEL_BLOCCO`).
 */
export type BloccoLetto = { dati: Record<string, unknown>; etichetta: string; vuoto: boolean };
export type EsitoBlocco = BloccoLetto | 'spento' | 'da_rileggere' | null;

export function leggiBlocco(fatti: unknown, chiave: string, adesso: Date): EsitoBlocco {
  if (BLOCCHI_MAI_MOSTRATI.has(chiave)) return null;
  const b = comeOggetto(comeOggetto(fatti)?.[chiave]);
  if (!b) return null;
  if (b.stato === 'spento') return 'spento';
  if (b.stato !== 'letto' && b.stato !== 'vuoto') return null;
  const nome = typeof b.fonte_nome === 'string' ? b.fonte_nome.replace(/\s+/g, ' ').trim() : '';
  if (nome.length < 2 || nome.length > 60 || FONTE_VIETATA.test(nome) || INDIRIZZO_WEB.test(nome)) return null;
  if (!dataDiLetturaValida(b.letto_il, adesso)) return null;
  if (typeof b.conserva_fino_al === 'string' && Date.parse(b.conserva_fino_al) < adesso.getTime()) return 'da_rileggere';
  const dati = comeOggetto(b.dati) ?? {};
  const licenza = typeof b.licenza === 'string' && /^[\w .-]{2,30}$/.test(b.licenza) ? b.licenza : null;
  return { dati, etichetta: etichettaFonte(nome, b.letto_il, licenza), vuoto: b.stato === 'vuoto' };
}

const fattiDi = (scheda: SchedaCliente | null | undefined) => (scheda?.analisi as Record<string, unknown> | undefined)?.fatti;
const businessDi = (scheda: SchedaCliente | null | undefined) => comeOggetto((scheda?.analisi as Record<string, unknown> | undefined)?.business);
const letto = (e: EsitoBlocco): e is BloccoLetto => !!e && typeof e === 'object';

/* ───────────────────────── l'assaggio, prima di pagare ───────────────────────── */

export type NumeroAssaggio = {
  id: 'concorrenti' | 'velocita_sito' | 'follower' | 'ricerche';
  titolo: string;
  /** Il numero detto in parole; `null` = «non ancora letto» o «in arrivo» (vedi `inArrivo`). */
  valore: string | null;
  /** Vero quando la fonte è spenta (contratto, regola 7): si dice «in arrivo», non «non trovato». */
  inArrivo: boolean;
  /** «Fonte: OpenStreetMap, letto il 26/11, licenza ODbL»; `null` quando il valore manca. */
  fonte: string | null;
};

export const NON_ANCORA_LETTO = 'non ancora letto';
export const IN_ARRIVO = 'in arrivo';

const it = (n: number, cifre = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: cifre });
type Valore = { valore: string | null; fonte: string | null; inArrivo: boolean };
const VUOTO: Valore = { valore: null, fonte: null, inArrivo: false };
const nonLetto = (e: EsitoBlocco): Valore => ({ ...VUOTO, inArrivo: e === 'spento' });

/**
 * I 4 numeri veri dell'assaggio, solo da fonti lecite (parere legale del 26/11): concorrenti vicini
 * (OpenStreetMap), velocità del sito (PageSpeed), follower Instagram, ricerche e posizione su Google (DataForSEO,
 * se acceso). Accanto, la scheda Google nel riquadro ufficiale di Google: qui nessun numero di Google.
 * Un numero che manca non diventa zero: «non ancora letto», o «in arrivo» se la fonte è spenta. Uno zero c'è solo
 * se è contato (stato `vuoto` o un numero 0 letto), e allora si dice in parole.
 */
export function assaggio(
  d: { scheda?: SchedaCliente | null; canali?: AnalisiCanali | null; sito?: RisultatoSito | null },
  adesso: Date,
): NumeroAssaggio[] {
  const fatti = fattiDi(d.scheda);

  const v = leggiBlocco(fatti, 'vicini', adesso);
  const conc = letto(v) ? comeOggetto(v.dati.concorrenti) : null;
  const n = intero(conc?.numero, 10_000);
  const raggio = intero(comeOggetto(letto(v) ? v.dati : null)?.raggio_m, 5_000);
  const concorrenti: Valore =
    letto(v) && n !== null
      ? { valore: n === 0 ? `nessuna attività simile${raggio ? ` entro ${it(raggio)} m` : ''}` : `${it(n)} ${n === 1 ? 'attività simile' : 'attività simili'}${raggio ? ` entro ${it(raggio)} m` : ' vicino a te'}`, fonte: v.etichetta, inArrivo: false }
      : nonLetto(v);

  // La velocità è la nostra misura di PageSpeed (analisi_negozi.sito): il contratto non la porta nei fatti.
  const velocita: Valore =
    d.sito?.velocita !== null && d.sito?.velocita !== undefined && dataDiLetturaValida(d.sito.fatta_il, adesso)
      ? { valore: `${it(d.sito.velocita)} su 100`, fonte: etichettaFonte('Google PageSpeed', d.sito.fatta_il), inArrivo: false }
      : VUOTO;

  const ig = leggiBlocco(fatti, 'instagram', adesso);
  const f = letto(ig) ? intero(ig.dati.follower) : null;
  let follower: Valore = letto(ig) && f !== null ? { valore: `${it(f)} su Instagram`, fonte: ig.etichetta, inArrivo: false } : nonLetto(ig);
  if (follower.valore === null && !follower.inArrivo) {
    // Se il rapporto non l'ha ancora, Instagram letto da n8n per la pagina «Analisi» (porta analisi-canali).
    const c = d.canali?.canali.instagram;
    const quando = c?.letto_il ?? d.canali?.fatta_il ?? null;
    const nc = c?.stato === 'fatta' ? c.numeri?.follower : undefined;
    if (nc !== undefined && dataDiLetturaValida(quando, adesso)) follower = { valore: `${it(nc)} su Instagram`, fonte: etichettaFonte('Instagram', quando), inArrivo: false };
  }

  const r = leggiBlocco(fatti, 'ricerche', adesso);
  const prima = letto(r) ? comeOggetto(elenco(r.dati.parole)[0]) : null;
  const quante = intero(prima?.ricerche_al_mese);
  const posizione = intero(prima?.posizione, 100);
  const parti = [quante !== null ? `${it(quante)} ricerche al mese` : null, posizione ? `sei ${it(posizione)}° su Google` : null].filter(Boolean);
  const ricerche: Valore = letto(r) && parti.length ? { valore: parti.join(', '), fonte: r.etichetta, inArrivo: false } : nonLetto(r);

  return [
    { id: 'concorrenti', titolo: 'Concorrenti vicini', ...concorrenti },
    { id: 'velocita_sito', titolo: 'Velocità del tuo sito', ...velocita },
    { id: 'follower', titolo: 'Chi ti segue', ...follower },
    { id: 'ricerche', titolo: 'Chi ti cerca su Google', ...ricerche },
  ];
}

/**
 * Il `place_id` della scheda Google, l'unico dato di Google che si tiene: `fatti.google.dati.place_id`
 * (contratto v1.2). `null` se manca, è spento o è storto.
 */
export function placeIdDi(scheda: SchedaCliente | null | undefined): string | null {
  const g = comeOggetto(comeOggetto(fattiDi(scheda))?.google);
  const id = typeof comeOggetto(g?.dati)?.place_id === 'string' ? String(comeOggetto(g?.dati)?.place_id).trim() : '';
  return g?.stato === 'letto' && /^[A-Za-z0-9_-]{10,300}$/.test(id) ? id : null;
}

/* ───────────────────────── le 12 parti, dopo il pagamento ───────────────────────── */

export type VoceRapporto = { titolo: string; dettaglio: string | null };
export type TemaReputazione = { tema: string; tono: 'positivo' | 'negativo' | 'misto'; quante: number };
/** Un pezzo di una parte, con la sua fonte e data: un blocco dei fatti o una sezione dell'AD. */
export type PezzoParte = { fonte: string | null; frasi: string[]; voci: VoceRapporto[]; temi: TemaReputazione[] };
/** Una parte: i suoi pezzi; `'da_rileggere'` se i dati sono scaduti (DataForSEO); `'in_arrivo'` se la fonte è spenta; `null` se non letta. */
export type Rapporto = Record<ParteRapporto, PezzoParte[] | 'da_rileggere' | 'in_arrivo' | null>;
/** Una voce di reputazione si mostra solo se il tema lo citano almeno 3 recensioni (parere legale del 26/11). */
export const RECENSIONI_MINIME_PER_TEMA = 3;

const pezzo = (fonte: string | null, p: Partial<PezzoParte>): PezzoParte | null => {
  const fuori = { fonte, frasi: p.frasi ?? [], voci: p.voci ?? [], temi: p.temi ?? [] };
  return fuori.frasi.length || fuori.voci.length || fuori.temi.length ? fuori : null;
};
const voce = (titolo: unknown, dettaglio?: unknown): VoceRapporto | null => {
  const t = fraseMostrabile(titolo, 2, 120);
  if (!t) return null;
  const d = dettaglio === undefined || dettaglio === null || dettaglio === '' ? null : fraseMostrabile(dettaglio, 2, 200);
  return { titolo: t, dettaglio: d };
};
const soloVoci = (v: Array<VoceRapporto | null>) => v.filter((x): x is VoceRapporto => !!x);

/** Una sezione dell'AD (contratto, sez. 2): ogni voce con la sua fonte https; senza, non esce. */
function sezioneAd(business: Record<string, unknown> | null, chiave: string, comeVoce: (o: Record<string, unknown>) => VoceRapporto | null, max: number): PezzoParte | null {
  const voci = soloVoci(elenco(business?.[chiave]).slice(0, max).map((x) => {
    const o = comeOggetto(x);
    return o && https(o.fonte) ? comeVoce(o) : null;
  }));
  return pezzo('Una lettura dell’AD di MyCity, ogni voce dalla sua fonte pubblica', { voci });
}

const n = (v: unknown) => intero(v);
const conNumero = (etichetta: string, v: unknown) => (n(v) !== null ? `${etichetta}: ${it(n(v)!)}` : null);

/** Il rapporto della scheda, parte per parte (contratto v1.2); `null` se non c'è niente da mostrare. */
export function leggiRapporto(scheda: SchedaCliente | null | undefined, adesso: Date): Rapporto | null {
  const fatti = fattiDi(scheda);
  const business = businessDi(scheda);
  const b = (k: string) => leggiBlocco(fatti, k, adesso);

  const parti: Partial<Record<ParteRapporto, Array<PezzoParte | null> | 'da_rileggere' | 'in_arrivo'>> = {};
  const metti = (p: ParteRapporto, e: EsitoBlocco, comePezzo: (x: BloccoLetto) => PezzoParte | null) => {
    if (e === 'spento' || e === 'da_rileggere') {
      if (!parti[p]) parti[p] = e === 'spento' ? 'in_arrivo' : 'da_rileggere';
      return;
    }
    if (!letto(e)) return;
    const lista = Array.isArray(parti[p]) ? (parti[p] as Array<PezzoParte | null>) : [];
    lista.push(comePezzo(e));
    parti[p] = lista;
  };
  const aggiungi = (p: ParteRapporto, x: PezzoParte | null) => {
    if (!x) return;
    const lista = Array.isArray(parti[p]) ? (parti[p] as Array<PezzoParte | null>) : [];
    lista.push(x);
    parti[p] = lista;
  };

  // 1 · La carta d'identità online: i controlli fatti sulle pagine del sito già scaricate.
  metti('identita_online', b('sito'), (x) => pezzo(x.etichetta, {
    voci: soloVoci([
      x.dati.https === true ? voce('Il sito è sicuro (https)') : x.dati.https === false ? voce('Il sito non è sicuro: manca https') : null,
      x.dati.viewport_mobile === true ? voce('Il sito è fatto per il telefono') : x.dati.viewport_mobile === false ? voce('Il sito non è fatto per il telefono') : null,
      x.dati.descrizione === true ? voce('Ha la descrizione che Google mostra sotto il nome') : x.dati.descrizione === false ? voce('Manca la descrizione che Google mostra sotto il nome') : null,
    ]),
  }));

  // 2 · La reputazione: SOLO temi, citati da almeno 3 recensioni. Niente frasi, testi, nomi.
  const temi = elenco(business?.reputazione_temi).slice(0, 6).flatMap((x): TemaReputazione[] => {
    const o = comeOggetto(x);
    const tema = fraseMostrabile(o?.tema, 2, 80);
    const tono = o?.tono === 'positivo' || o?.tono === 'negativo' || o?.tono === 'misto' ? o.tono : null;
    const q = intero(o?.quante);
    if (!o || !https(o.fonte) || !tema || !tono || q === null || q < RECENSIONI_MINIME_PER_TEMA) return [];
    // Un tema è una cosa («i dolci»), mai una persona: un nome e cognome, o una parola con la maiuscola dopo la
    // prima («la cameriera Giulia»), lo scarta. Un nome scritto tutto minuscolo non si riconosce: lo esclude il
    // contratto (regola 3), qui resta il tetto di 80 caratteri e il minimo di 3 recensioni.
    if (NOME_E_COGNOME.test(tema) || /\s[A-ZÀ-Ý]/.test(tema)) return [];
    return [{ tema, tono, quante: q }];
  });
  aggiungi('reputazione', pezzo('Fonte: DataForSEO, temi delle recensioni pubbliche', { temi }));

  // 3 · I concorrenti vicini: quanti e quali, da OpenStreetMap. Mai voti né classifiche.
  metti('concorrenti', b('vicini'), (x) => {
    const c = comeOggetto(x.dati.concorrenti);
    const num = intero(c?.numero, 10_000);
    const raggio = intero(x.dati.raggio_m, 5_000);
    const voci = soloVoci(elenco(c?.elenco).slice(0, 10).map((e) => {
      const o = comeOggetto(e);
      const d = intero(o?.distanza_m, 50_000);
      return voce(o?.nome, d !== null ? `a ${it(d)} m` : null);
    }));
    const frasi = num === null ? [] : [num === 0 ? `Nessuna attività come la tua${raggio ? ` entro ${it(raggio)} metri` : ''}.` : `${it(num)} ${num === 1 ? 'attività come la tua' : 'attività come la tua'}${raggio ? ` entro ${it(raggio)} metri` : ''}.`];
    return pezzo(x.etichetta, { frasi, voci });
  });
  aggiungi('concorrenti', sezioneAd(business, 'confronto_concorrenti', (o) => voce(o.nome, o.differenza), 5));

  // 4 · La zona: i servizi vicini, da OpenStreetMap.
  metti('zona', b('vicini'), (x) => {
    const s = comeOggetto(x.dati.servizi);
    return pezzo(x.etichetta, {
      voci: soloVoci([
        conNumero('Fermate dell’autobus', s?.fermate_bus), conNumero('Parcheggi', s?.parcheggi), conNumero('Scuole', s?.scuole),
        conNumero('Uffici pubblici', s?.uffici_pubblici), conNumero('Farmacie', s?.farmacie), conNumero('Negozi', s?.negozi_totali),
      ].map((t) => (t ? voce(t) : null))),
    });
  });

  // 5 · Cosa cerca la gente: le ricerche su Google a Piacenza (DataForSEO, scadono con conserva_fino_al).
  metti('ricerche', b('ricerche'), (x) => pezzo(x.etichetta, {
    voci: soloVoci(elenco(x.dati.parole).slice(0, 10).map((e) => {
      const o = comeOggetto(e);
      const q = intero(o?.ricerche_al_mese);
      const pos = intero(o?.posizione, 100);
      const dettaglio = [q !== null ? `${it(q)} ricerche al mese` : null, pos ? `sei ${it(pos)}°` : null].filter(Boolean).join(', ');
      return voce(o?.parola, dettaglio || null);
    })),
  }));

  // 6 · Il sito: il titolo e i dati strutturati (la velocità è nel blocco «Il tuo sito» della pagina).
  metti('sito', b('sito'), (x) => pezzo(x.etichetta, {
    voci: soloVoci([
      typeof x.dati.titolo === 'string' ? voce('Il titolo della pagina', x.dati.titolo) : x.dati.titolo === null ? voce('La pagina non ha un titolo') : null,
      Array.isArray(x.dati.dati_strutturati) ? voce(x.dati.dati_strutturati.length ? 'Google legge i dati del locale nel sito' : 'Il sito non dice a Google i dati del locale') : null,
    ]),
  }));

  // 7 · I social: Instagram (Business Discovery).
  metti('social', b('instagram'), (x) => pezzo(x.etichetta, {
    voci: soloVoci([
      conNumero('Follower', x.dati.follower), conNumero('Post negli ultimi 30 giorni', x.dati.post_ultimi_30_giorni),
      conNumero('Video negli ultimi 30 giorni', x.dati.video_ultimi_30_giorni), conNumero('Interazioni medie per post', x.dati.interazioni_medie),
    ].map((t) => (t ? voce(t) : null))),
  }));

  // 8 · Il calendario della città: eventi, meteo (MET Norway, CC BY 4.0), le occasioni dell'AD.
  metti('calendario', b('eventi'), (x) => pezzo(x.etichetta, { voci: soloVoci(elenco(x.dati.elenco).slice(0, 8).map((e) => voce(comeOggetto(e)?.titolo))) }));
  metti('calendario', b('meteo'), (x) => pezzo(x.etichetta, {
    voci: soloVoci(elenco(x.dati.giorni).slice(0, 7).map((e) => {
      const o = comeOggetto(e);
      const data = typeof o?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.data) ? giornoEMese(`${o.data}T12:00:00Z`) : null;
      const tempo = typeof o?.tempo === 'string' && /^[a-z]{3,12}$/.test(o.tempo) ? o.tempo : null;
      const max = typeof o?.max_c === 'number' && Number.isFinite(o.max_c) ? `massima ${Math.round(o.max_c)}°` : null;
      return data && tempo ? voce(`${data}: ${tempo}`, max) : null;
    })),
  }));
  aggiungi('calendario', sezioneAd(business, 'occasioni', (o) => voce(o.cosa, o.perche_conta), 5));

  // 9 · Soldi pubblici: i bandi trovati, e quelli che l'AD ha scelto per te.
  metti('bandi', b('bandi'), (x) => pezzo(x.etichetta, { voci: soloVoci(elenco(x.dati.elenco).slice(0, 6).map((e) => voce(comeOggetto(e)?.titolo))) }));
  aggiungi('bandi', sezioneAd(business, 'soldi_pubblici', (o) => voce(o.bando, [o.per_chi, typeof o.scadenza === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.scadenza) ? `scade il ${giornoEMese(`${o.scadenza}T12:00:00Z`)}` : null].filter(Boolean).join(' · ') || null), 4));

  // 10 · Su MyCity: i numeri del negozio sono nella pagella, nella stessa pagina (flusso 18): qui non si ripetono.

  // 11 · Il piano dei 30 giorni, settimana per settimana.
  aggiungi('piano_30_giorni', sezioneAd(business, 'piano_30_giorni', (o) => {
    const s = intero(o.settimana, 4);
    return s && s >= 1 ? voce(`Settimana ${s}`, o.azione) : null;
  }, 8));

  // 12 · I concorrenti sui social e sul web: cosa fanno, e le idee che ne nascono.
  metti('concorrenti_web', b('concorrenti_canali'), (x) => pezzo(x.etichetta, {
    voci: soloVoci(elenco(x.dati.elenco).slice(0, 5).map((e) => {
      const o = comeOggetto(e);
      const igc = comeOggetto(o?.instagram);
      const sito = comeOggetto(o?.sito);
      const dettaglio = [
        igc && intero(igc.follower) !== null ? `${it(intero(igc.follower)!)} follower su Instagram` : null,
        igc && intero(igc.post_ultimi_30_giorni) !== null ? `${it(intero(igc.post_ultimi_30_giorni)!)} post in 30 giorni` : null,
        sito?.c_e === true ? `sito ${typeof sito.livello === 'string' && /^(semplice|medio|pregio)$/.test(sito.livello) ? sito.livello : 'presente'}` : sito?.c_e === false ? 'senza sito' : null,
      ].filter(Boolean).join(' · ');
      return voce(o?.nome, dettaglio || null);
    })),
  }));
  aggiungi('concorrenti_web', sezioneAd(business, 'confronto_concorrenti', (o) => (o.meglio || o.peggio ? voce(o.nome, [o.meglio ? `fa meglio: ${o.meglio}` : null, o.peggio ? `fa peggio: ${o.peggio}` : null].filter(Boolean).join(' · ')) : null), 5));
  aggiungi('concorrenti_web', sezioneAd(business, 'idee_dal_confronto', (o) => voce(o.idea, o.perche), 3));

  const fuori = Object.fromEntries(PARTI_RAPPORTO.map((p) => {
    const v = parti[p];
    if (v === 'da_rileggere' || v === 'in_arrivo') return [p, v];
    const pieni = (v ?? []).filter((x): x is PezzoParte => !!x);
    return [p, pieni.length ? pieni : null];
  })) as Rapporto;
  return PARTI_RAPPORTO.some((p) => fuori[p] !== null) ? fuori : null;
}

/**
 * L'analisi come la riceve chi non ha ancora pagato: dei fatti solo i blocchi dell'assaggio (vicini, ricerche,
 * instagram) e il place_id; delle sezioni nuove dell'AD niente. Così il rapporto intero non esce dal server prima
 * del pagamento, nemmeno nella risposta che il browser riceve. Le sezioni di prima (`business.situazione`…)
 * restano: si vedevano già in demo.
 */
const BLOCCHI_DELL_ASSAGGIO = ['vicini', 'ricerche', 'instagram', 'google'] as const;
export const SEZIONI_NUOVE_AD = ['reputazione_temi', 'confronto_concorrenti', 'occasioni', 'soldi_pubblici', 'piano_30_giorni', 'idee_dal_confronto', 'parti'] as const;
export function analisiPerChiNonHaPagato<T extends Record<string, unknown> | undefined>(analisi: T): T {
  if (!analisi) return analisi;
  const { fatti, business, rapporto: _vecchio, ...resto } = analisi as Record<string, unknown>;
  const f = comeOggetto(fatti);
  const out: Record<string, unknown> = { ...resto };
  if (f) {
    const tenuti = Object.fromEntries(BLOCCHI_DELL_ASSAGGIO.filter((k) => k in f).map((k) => {
      const b = comeOggetto(f[k]);
      if (!b) return [k, null];
      // Del blocco vicini all'assaggio serve solo il numero: l'elenco dei nomi è del rapporto intero.
      if (k === 'vicini') {
        const d = comeOggetto(b.dati);
        const c = comeOggetto(d?.concorrenti);
        return [k, { ...b, dati: d ? { raggio_m: d.raggio_m, concorrenti: { numero: c?.numero ?? null } } : null }];
      }
      if (k === 'instagram') {
        const d = comeOggetto(b.dati);
        return [k, { ...b, dati: d ? { follower: d.follower } : null }];
      }
      if (k === 'ricerche') {
        const d = comeOggetto(b.dati);
        return [k, { ...b, dati: d ? { parole: elenco(d.parole).slice(0, 1) } : null }];
      }
      return [k, b];
    }));
    out.fatti = tenuti;
  }
  const bz = comeOggetto(business);
  if (bz) out.business = Object.fromEntries(Object.entries(bz).filter(([k]) => !(SEZIONI_NUOVE_AD as readonly string[]).includes(k)));
  return out as T;
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
 *  · `fatti.google.dati` resta col solo `place_id`; `fatti.tripadvisor.dati` col solo `location_id`;
 *  · `fatti.recensioni.dati` perde voto medio, stelle e qualunque testo: sono voti e recensioni di Google letti da
 *    DataForSEO, e al sito arrivano solo i temi;
 *  · `business.reputazione_temi` tiene solo i temi citati da almeno 3 recensioni, senza testi;
 *  · `business.confronto_concorrenti` perde voto e recensioni dei concorrenti (oggi null per contratto);
 *  · la busta della vecchia bozza (`analisi.google` in cima, `analisi.rapporto`) non si salva.
 * Il resto resta com'è arrivato: la lettura (`leggiRapporto`) lo ripulisce di nuovo prima di mostrarlo.
 */
/** Una chiave che dice Google o TripAdvisor («voto_google», «recensioni_tripadvisor»): fuori, ovunque si trovi. */
const CHIAVE_VIETATA = /google|tripadvisor|gmaps/i;
/** Le chiavi dei testi delle recensioni e di chi le scrive: al sito non arrivano mai. */
const CHIAVE_DI_RECENSIONE = /^(testo|testi|autore|autori|citazione|citazioni|recensioni_testi|nome_autore|foto)$/i;

/** La posizione nei risultati di Google letta da DataForSEO non è un dato di Google Places: resta. */
const CHIAVI_AMMESSE = new Set(['posizione_google', 'posizione_su_google']);

/**
 * Toglie, a ogni profondità, le chiavi che dicono Google o TripAdvisor (tranne quelle in `tieni`, valide solo al
 * primo livello) e, con `ancheRecensioni`, quelle dei testi delle recensioni. Le sezioni di prima dell'AD usano
 * `testo` per le loro frasi: lì `ancheRecensioni` è spento.
 */
function senzaChiaviVietate(v: unknown, tieni: readonly string[] = [], ancheRecensioni = false, profondita = 0): unknown {
  if (profondita > 8) return null;
  if (Array.isArray(v)) return v.map((x) => senzaChiaviVietate(x, [], ancheRecensioni, profondita + 1));
  const o = comeOggetto(v);
  if (!o) return v;
  return Object.fromEntries(
    Object.entries(o)
      .filter(([k]) => tieni.includes(k) || CHIAVI_AMMESSE.has(k) || (!CHIAVE_VIETATA.test(k) && !(ancheRecensioni && CHIAVE_DI_RECENSIONE.test(k))))
      .map(([k, x]) => [k, senzaChiaviVietate(x, [], ancheRecensioni, profondita + 1)]),
  );
}

/**
 * Vero se una frase con la sua fonte sembra un dato di Google o TripAdvisor ricopiato: la fonte è una loro pagina,
 * o il testo dice un loro voto o un conto di recensioni. La usa anche l'analisi del business di prima (analisi.ts).
 */
export function pareDatoDiGoogle(testo: string, fonte?: string | null): boolean {
  return (typeof fonte === 'string' && FONTE_GOOGLE.test(fonte)) || NUMERO_DI_GOOGLE.test(testo);
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const LOCATION_ID = /^\d{1,20}$/;
/** Una fonte che è una pagina di Google Maps o TripAdvisor: un campo letto lì non si salva (parere legale del 26/11). */
const FONTE_GOOGLE = /^https?:\/\/([\w-]+\.)*(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|tripadvisor\.)/i;

/**
 * I campi della scheda come si salvano: un campo la cui fonte è Google Maps o TripAdvisor (orari, indirizzo,
 * telefono letti lì) non si salva, e nemmeno un campo con un nome che dice Google. Il titolare li scrive lui.
 */
export function campiDaSalvare<T extends Record<string, { fonte?: string | null } | undefined>>(campi: T): T {
  return Object.fromEntries(
    Object.entries(campi).filter(([nome, c]) => !CHIAVE_VIETATA.test(nome) && !(typeof c?.fonte === 'string' && FONTE_GOOGLE.test(c.fonte))),
  ) as T;
}

export function analisiDaSalvare<T extends Record<string, unknown> | undefined>(analisi: T): T {
  if (!analisi) return analisi;
  const { rapporto: _r, fatti: grezzi, ...resto } = analisi as Record<string, unknown>;
  // Le chiavi che dicono Google o TripAdvisor si tolgono dappertutto (anche la vecchia busta `analisi.google`).
  const a = senzaChiaviVietate(resto) as Record<string, unknown>;

  const fg = comeOggetto(grezzi);
  if (fg) {
    // I blocchi google e tripadvisor si tengono (col solo identificativo, controllato); il resto senza chiavi vietate.
    const f = senzaChiaviVietate(fg, ['google', 'tripadvisor'], true) as Record<string, unknown>;
    const soloId = (k: 'google' | 'tripadvisor', campo: string, forma: RegExp) => {
      const b = comeOggetto(f[k]);
      if (!b) return;
      const d = comeOggetto(b.dati);
      const id = typeof d?.[campo] === 'string' ? String(d[campo]).trim() : '';
      const busta = senzaChiaviVietate({ ...b, dati: null }, [], true) as Record<string, unknown>;
      f[k] = { ...busta, dati: forma.test(id) ? { [campo]: id } : null };
    };
    soloId('google', 'place_id', PLACE_ID);
    soloId('tripadvisor', 'location_id', LOCATION_ID);
    const rec = comeOggetto(f.recensioni);
    if (rec) {
      const d = comeOggetto(rec.dati);
      f.recensioni = { ...rec, dati: d ? Object.fromEntries(['lette', 'con_risposta', 'ultima_il'].filter((x) => x in d).map((x) => [x, d[x]])) : null };
    }
    a.fatti = f;
  }

  const bz = comeOggetto(a.business);
  if (bz) {
    const b2: Record<string, unknown> = { ...bz };
    if ('reputazione_temi' in bz) {
      b2.reputazione_temi = elenco(bz.reputazione_temi).flatMap((x) => {
        const o = comeOggetto(x);
        const q = intero(o?.quante);
        return o && q !== null && q >= RECENSIONI_MINIME_PER_TEMA ? [{ tema: o.tema, tono: o.tono, quante: q, fonte: o.fonte }] : [];
      });
    }
    if ('confronto_concorrenti' in bz) {
      b2.confronto_concorrenti = elenco(bz.confronto_concorrenti).flatMap((x) => {
        const o = comeOggetto(x);
        if (!o) return [];
        const { voto: _v, recensioni: _rc, ...resto } = o;
        return [resto];
      });
    }
    a.business = b2;
  }
  return a as T;
}

/* ───────────────────────── dopo il pagamento: solo le parti dell'abbonamento ───────────────────────── */

/**
 * L'analisi come la riceve chi ha pagato `fascia`: i blocchi e le sezioni delle parti escluse non escono dal
 * server (dal collaudo del 26/11: prima le nascondeva solo la pagina, e si leggevano negli strumenti del browser).
 * Con `fascia` nulla (abbonamento disdetto, negozio online da prima della demo) vale il Base: il più prudente.
 */
const BLOCCO_DELLA_PARTE: Partial<Record<string, ParteRapporto>> = { ricerche: 'ricerche', concorrenti_canali: 'concorrenti_web', instagram: 'social', eventi: 'calendario', meteo: 'calendario', bandi: 'bandi' };
const SEZIONE_DELLA_PARTE: Partial<Record<string, ParteRapporto>> = { idee_dal_confronto: 'concorrenti_web', occasioni: 'calendario', soldi_pubblici: 'bandi', piano_30_giorni: 'piano_30_giorni', reputazione_temi: 'reputazione' };
export function analisiPerLaFascia<T extends Record<string, unknown> | undefined>(analisi: T, fascia: Abbonamento | null): T {
  if (!analisi) return analisi;
  const parti = ANALISI_PER_FASCIA[fascia ?? 'base'].parti;
  const esclusa = (p: ParteRapporto | undefined) => !!p && parti[p] === null;
  const a = { ...(analisi as Record<string, unknown>) };
  const f = comeOggetto(a.fatti);
  if (f) a.fatti = Object.fromEntries(Object.entries(f).filter(([k]) => !esclusa(BLOCCO_DELLA_PARTE[k])));
  const b = comeOggetto(a.business);
  if (b) {
    const b2 = Object.fromEntries(Object.entries(b).filter(([k]) => !esclusa(SEZIONE_DELLA_PARTE[k])));
    // Il confronto coi concorrenti serve alla parte 3; «fa meglio / fa peggio» è della parte 12.
    if (esclusa('concorrenti_web') && Array.isArray(b2.confronto_concorrenti)) {
      b2.confronto_concorrenti = b2.confronto_concorrenti.map((x) => {
        const o = comeOggetto(x);
        if (!o) return x;
        const { meglio: _m, peggio: _p, fonte_canali: _fc, ...resto } = o;
        return resto;
      });
    }
    a.business = b2;
  }
  return a as T;
}
