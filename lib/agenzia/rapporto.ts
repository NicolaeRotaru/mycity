import type { Abbonamento } from './preventivo';
import { senzaPrezzo, type SchedaCliente } from './scheda-cliente';
import { haUnNomeDiPersona } from './nomi-di-persona';
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
const INDIRIZZO_WEB = /https?:\/\/|www\.|\b[\w-]+\.(?:it|com|net|org|eu|info|biz|io|app|xyz|ly|to|me|shop|store|online|site|ee|de|fr|es|ch|at|uk|co|gl|page|link|bio)(?:\/|\b)|\b[\w-]+\.[a-z]{2,10}\/\S/i;
/** Un voto («4,6 su 5», «4.5 stelle») non è un prezzo. */
const VOTO = /\d[.,]\d\s*(su\s*5|\/\s*5|stell[ae])/gi;
/** Due parole di fila con la maiuscola («Mario Rossi»): quasi sempre un nome di persona. */
/**
 * Un nome e cognome di persona («Mario Rossi»), riconosciuto da un elenco di nomi propri (lib/agenzia/nomi-di-persona.ts):
 * «Google Maps», «Natale», «Piazza Cavalli» restano (ricontrollo di mycity#336). Ha la forma di una RegExp (`test`).
 */
const NOME_E_COGNOME = { test: (t: string) => haUnNomeDiPersona(t) };
/** «@nome», anche fra parentesi: nel rapporto non si citano persone né profili altrui (chi recensisce, chi commenta). */
const MENZIONE = /[@＠]\s*[\p{L}\d_.]{2,}/u;
/** Un indirizzo email detto a parole («mario @ gmail punto com»). */
const EMAIL_A_PAROLE = /\b(gmail|libero|hotmail|yahoo|outlook|icloud|alice|tiscali|virgilio)\b|\bpunto\s+(com|it|net)\b/i;
/**
 * Un voto o un conto di recensioni ricopiato da Google o TripAdvisor («4,6 su Google», «120 recensioni»,
 * «quattro e mezzo su cinque»): non è un nostro dato e non si mostra (parere legale del 26/11).
 */
// Dal terzo collaudo: la regola di prima scartava anche «il sito del 2015 senza mappa di Google» o «3 post con le
// stelle di Natale». Ora ci vuole un voto (4,6), un conto di recensioni o di stelle, o «voto» vicino al nome.
const NUMERO_DI_GOOGLE = /(google|maps|tripadvisor)[^.]*(\d[.,]\d|\d\s*stell|\bvoto|\d+\s*recension)|(\d[.,]\d|\d+\s*recension|\d\s*stell)[^.]*(google|maps|tripadvisor)|\d+\s*recensioni\b|su cinque\b/i;
/** Un prezzo detto senza moneta («25 a persona», «coperto 3»): `senzaPrezzo` guarda la moneta e i decimali. */
/** Nel rapporto nessun voto in stelle, di nessuno («4,6 su 5», «4.6/5»): i voti sono di Google o TripAdvisor. */
// Una data come «31/5» non è un voto (collaudo finale): «/5» conta solo dopo un decimale («4,6/5»).
const UN_VOTO = /\d\s*([.,]\s*\d)?\s*su\s*(5|cinque)\b|\d[.,]\d\s*\/\s*5\b/i;
const PREZZO_SENZA_MONETA = /\d+\s*(a persona|a testa|cad\.?|al pezzo|al chilo|al kg)\b|\bcoperto\s*\d/i;

/**
 * Un tema è una cosa scritta in minuscolo («i dolci», «il servizio»), mai una persona: qualunque maiuscola
 * («Giulia», «personale (Giulia)», «il titolare,Rossi») lo scarta. Un nome scritto tutto minuscolo non si
 * riconosce: lo esclude il contratto (regola 3); qui restano il tetto di 80 caratteri e il minimo di 3 recensioni.
 */
export function temaMostrabile(tema: unknown): tema is string {
  return typeof tema === 'string' && !!fraseMostrabile(tema, 2, 80) && tema === tema.toLowerCase() && !NOME_E_COGNOME.test(tema);
}

/** Una frase che si può mostrare, ripulita; `null` se ha un prezzo, un contatto, un link, una menzione o un numero di Google. */
export function fraseMostrabile(v: unknown, min = 10, max = 300): string | null {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length < min || t.length > max) return null;
  if (!senzaPrezzo(t.replace(VOTO, 'voto'))) return null;
  if (CONTATTO.test(t) || INDIRIZZO_WEB.test(t) || MENZIONE.test(t) || EMAIL_A_PAROLE.test(t) || NUMERO_DI_GOOGLE.test(t) || UN_VOTO.test(t) || PREZZO_SENZA_MONETA.test(t)) return null;
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
  /** Il numero detto in parole; `null` se manca, e allora c'è `motivo`. */
  valore: string | null;
  /**
   * Perché il numero manca, detto in parole vere (revisione di mycity#336: prima la Ragazzetta leggeva per sempre
   * «non ancora letto» su 3 numeri su 4): «Non hai ancora un sito», «Non abbiamo trovato un profilo Instagram»…
   */
  motivo: string | null;
  /** Vero quando la fonte è spenta (contratto, regola 7): non è un «non trovato». */
  inArrivo: boolean;
  /** Una nota sulla fascia («Nel Base non c'è»), quando il numero è di una parte che il Base non ha. */
  nota: string | null;
  /** «Fonte: OpenStreetMap, letto il 26/11, licenza ODbL»; `null` quando il valore manca. */
  fonte: string | null;
};

export const NON_ANCORA_LETTO = 'Non ancora letto: lo leggiamo a breve.';
export const LETTURA_NON_ATTIVA = 'Questa lettura non è ancora attiva: la accendiamo noi.';

const it = (n: number, cifre = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: cifre });
type Valore = { valore: string | null; fonte: string | null; motivo: string | null; inArrivo: boolean };
const conValore = (valore: string, fonte: string): Valore => ({ valore, fonte, motivo: null, inArrivo: false });
const senza = (motivo: string, inArrivo = false): Valore => ({ valore: null, fonte: null, motivo, inArrivo });

/** Lo stato grezzo di un blocco dei fatti (`letto`, `vuoto`, `spento`, `non_applicabile`, `errore`), o `null`. */
const statoDi = (fatti: unknown, chiave: string): string | null => {
  const st = comeOggetto(comeOggetto(fatti)?.[chiave])?.stato;
  return typeof st === 'string' ? st : null;
};
/** Il motivo detto in parole per uno stato che non ha un numero. */
const motivoDelloStato = (stato: string | null, seNonApplicabile: string, seVuoto: string): string | null =>
  stato === 'spento' ? LETTURA_NON_ATTIVA : stato === 'non_applicabile' ? seNonApplicabile : stato === 'vuoto' ? seVuoto : stato === 'errore' ? 'La lettura non è riuscita: la rifacciamo noi.' : null;

/** Quello che il sito sa già, per dire il motivo giusto quando un numero manca. */
export type CosaSappiamo = { haSito?: boolean; instagramScritto?: boolean };

/**
 * I 4 numeri veri dell'assaggio, solo da fonti lecite (parere legale del 26/11): concorrenti vicini
 * (OpenStreetMap), velocità del sito (PageSpeed), follower Instagram, ricerche e posizione su Google (DataForSEO,
 * se acceso). Accanto, la scheda Google nel riquadro ufficiale di Google: qui nessun numero di Google.
 * Un numero che manca non diventa zero: si dice perché manca. Uno zero c'è solo se è contato (stato `vuoto` o un
 * numero 0 letto), e allora si dice in parole.
 */
export function assaggio(
  d: { scheda?: SchedaCliente | null; canali?: AnalisiCanali | null; sito?: RisultatoSito | null } & CosaSappiamo,
  adesso: Date,
): NumeroAssaggio[] {
  const fatti = fattiDi(d.scheda);

  const v = leggiBlocco(fatti, 'vicini', adesso);
  const conc = letto(v) ? comeOggetto(v.dati.concorrenti) : null;
  // Stato `vuoto` = ha risposto e non c'è niente: il conto è zero anche se il numero non è scritto (contratto, sez. 1).
  const n = intero(conc?.numero, 10_000) ?? (letto(v) && v.vuoto ? 0 : null);
  const raggio = intero(comeOggetto(letto(v) ? v.dati : null)?.raggio_m, 5_000);
  const concorrenti: Valore =
    letto(v) && n !== null
      ? conValore(n === 0 ? `nessuna attività simile${raggio ? ` entro ${it(raggio)} m` : ''}` : `${it(n)} ${n === 1 ? 'attività simile' : 'attività simili'}${raggio ? ` entro ${it(raggio)} m` : ' vicino a te'}`, v.etichetta)
      : senza(
          letto(v) ? 'Il tipo della tua attività non si riconosce sulla mappa: lo contiamo insieme a te.' : motivoDelloStato(statoDi(fatti, 'vicini'), 'Non vale per la tua attività.', 'Non abbiamo trovato attività simili vicino a te.') ?? NON_ANCORA_LETTO,
          statoDi(fatti, 'vicini') === 'spento',
        );

  // La velocità è la nostra misura di PageSpeed (analisi_negozi.sito): il contratto non la porta nei fatti.
  const velocita: Valore =
    d.sito?.velocita !== null && d.sito?.velocita !== undefined && dataDiLetturaValida(d.sito.fatta_il, adesso)
      ? conValore(`${it(d.sito.velocita)} su 100`, etichettaFonte('Google PageSpeed', d.sito.fatta_il))
      : senza(d.haSito ? 'Il tuo sito non l’abbiamo ancora misurato: lo fai qui sotto, in «Il tuo sito».' : 'Non hai ancora un sito: lo misuriamo quando c’è.');

  const ig = leggiBlocco(fatti, 'instagram', adesso);
  const statoIg = statoDi(fatti, 'instagram');
  const f = letto(ig) ? intero(ig.dati.follower) : null;
  let follower: Valore;
  // Stato `vuoto` = Instagram non c'è: il motivo, non «0 su Instagram» (ricontrollo di mycity#336).
  if (letto(ig) && f !== null && !ig.vuoto) follower = conValore(`${it(f)} su Instagram`, ig.etichetta);
  else if (statoIg && statoIg !== 'spento') follower = senza(motivoDelloStato(statoIg, 'Instagram non vale per la tua attività.', 'Non abbiamo trovato un profilo Instagram dell’attività.') ?? NON_ANCORA_LETTO);
  else {
    // Il rapporto non ha i follower (blocco assente o spento): quelli letti da n8n per la pagina «Analisi», se ci sono
    // (ricontrollo di mycity#336: con Instagram spento l'assaggio diceva «non attiva» mentre i follower si sapevano).
    const c = d.canali?.canali.instagram;
    const quando = c?.letto_il ?? d.canali?.fatta_il ?? null;
    const nc = c?.stato === 'fatta' ? c.numeri?.follower : undefined;
    if (nc !== undefined && dataDiLetturaValida(quando, adesso)) follower = conValore(`${it(nc)} su Instagram`, etichettaFonte('Instagram', quando));
    else if (c?.stato === 'non_trovato') follower = senza('Non abbiamo trovato il profilo Instagram che ci hai scritto: controlla il nome.');
    else if (c?.stato === 'privato') follower = senza('Il profilo Instagram è privato: dai dati pubblici non si legge.');
    else if (statoIg === 'spento') follower = senza(LETTURA_NON_ATTIVA, true);
    else follower = senza(d.instagramScritto ? NON_ANCORA_LETTO : 'Non conosciamo ancora il tuo Instagram: scrivilo qui sotto, in «I tuoi canali».');
  }

  const r = leggiBlocco(fatti, 'ricerche', adesso);
  const prima = letto(r) ? comeOggetto(elenco(r.dati.parole)[0]) : null;
  const quante = intero(prima?.ricerche_al_mese);
  const posizione = intero(prima?.posizione, 100);
  const parti = [quante !== null ? `${it(quante)} ricerche al mese` : null, posizione ? `sei ${it(posizione)}° su Google` : null].filter(Boolean);
  const ricerche: Valore =
    letto(r) && parti.length
      ? conValore(parti.join(', '), r.etichetta)
      : senza(r === 'da_rileggere' ? 'I dati letti sono scaduti: li leggiamo di nuovo.' : motivoDelloStato(statoDi(fatti, 'ricerche'), 'Non vale per la tua attività.', 'Per la tua attività non abbiamo trovato ricerche a Piacenza.') ?? NON_ANCORA_LETTO, statoDi(fatti, 'ricerche') === 'spento');

  // Una nota quando il numero è di una parte che il Base non comprende (revisione di mycity#336).
  const notaBase = (p: ParteRapporto) => (ANALISI_PER_FASCIA.base.parti[p] === null ? 'Nel rapporto del Base non c’è: è nel Business e nel Premium.' : null);

  return [
    { id: 'concorrenti', titolo: 'Concorrenti vicini', nota: notaBase('concorrenti'), ...concorrenti },
    { id: 'velocita_sito', titolo: 'Velocità del tuo sito', nota: notaBase('sito'), ...velocita },
    { id: 'follower', titolo: 'Chi ti segue', nota: notaBase('social'), ...follower },
    { id: 'ricerche', titolo: 'Chi ti cerca su Google', nota: notaBase('ricerche'), ...ricerche },
  ];
}

/**
 * Perché una parte del rapporto non ha contenuto, detto come nell'assaggio (ricontrollo di mycity#336: dopo il
 * pagamento le parti 1, 6 e 7 dicevano «Non ancora letta» per sempre). `null` = nessun motivo noto.
 */
export function motivoDellaParte(parte: ParteRapporto, numeri: readonly NumeroAssaggio[]): string | null {
  const di = (id: NumeroAssaggio['id']) => numeri.find((n) => n.id === id)?.motivo ?? null;
  if (parte === 'identita_online' || parte === 'sito') return di('velocita_sito');
  if (parte === 'social') return di('follower');
  if (parte === 'concorrenti' || parte === 'zona') return di('concorrenti');
  if (parte === 'ricerche') return di('ricerche');
  return null;
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
  const d = dettaglio === undefined || dettaglio === null || dettaglio === '' ? null : fraseMostrabile(dettaglio, 2, 400);
  return { titolo: t, dettaglio: d };
};
const soloVoci = (v: Array<VoceRapporto | null>) => v.filter((x): x is VoceRapporto => !!x);
/**
 * Un testo dell'AD che descrive o propone (non un nome di attività o di evento): un nome e cognome lo scarta,
 * come nei temi (revisione di mycity#336). I titoli che SONO nomi (un concorrente, un bando, un evento) non passano di qui.
 */
const prosa = (v: unknown, min = 3, max = 200): string | null => {
  const t = fraseMostrabile(v, min, max);
  return t && !NOME_E_COGNOME.test(t) ? t : null;
};

/** Una sezione dell'AD (contratto, sez. 2): ogni voce con la sua fonte https; senza, non esce. */
/**
 * Una sezione dell'AD (contratto, sez. 2): ogni voce con la sua fonte https, che non sia una pagina di Google o
 * TripAdvisor; senza, non esce. La data è quella della lettura dell'AD (`etichettaAd`): senza data non si mostra.
 */
function sezioneAd(business: Record<string, unknown> | null, chiave: string, comeVoce: (o: Record<string, unknown>) => VoceRapporto | null, max: number, etichetta: string | null): PezzoParte | null {
  if (!etichetta) return null;
  const voci = soloVoci(elenco(business?.[chiave]).slice(0, max).map((x) => {
    const o = comeOggetto(x);
    const f = o ? https(o.fonte) : null;
    return o && f && !pareDatoDiGoogle('', f) && !fonteDataForSeo(f) ? comeVoce(o) : null;
  }));
  return pezzo(etichetta, { voci });
}

const n = (v: unknown) => intero(v);
const conNumero = (etichetta: string, v: unknown) => (n(v) !== null ? `${etichetta}: ${it(n(v)!)}` : null);

/** Il rapporto della scheda, parte per parte (contratto v1.2); `null` se non c'è niente da mostrare. */
export function leggiRapporto(scheda: SchedaCliente | null | undefined, adesso: Date): Rapporto | null {
  const fatti = fattiDi(scheda);
  const business = businessDi(scheda);
  const b = (k: string) => leggiBlocco(fatti, k, adesso);
  // La data della lettura dell'AD: `business_fatta_il` (N8N#16), o in mancanza quando la scheda è partita.
  const quandoAd = [(scheda?.analisi as Record<string, unknown> | undefined)?.business_fatta_il, scheda?.inviato_il].find((d) => dataDiLetturaValida(d, adesso)) as string | undefined;
  const ad = quandoAd ? `Una lettura di MyCity del ${giornoEMese(quandoAd)}, ogni voce dalla sua fonte pubblica` : null;

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
      x.dati.https === true ? voce('Il sito è sicuro (https)') : x.dati.https === false ? voce('Il tuo sito non è protetto: manca https, e i browser lo segnalano a chi lo apre') : null,
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
    if (!o || !https(o.fonte) || fonteDiGoogle(String(o.fonte)) || !tema || !tono || q === null || q < RECENSIONI_MINIME_PER_TEMA) return [];
    if (!temaMostrabile(tema)) return [];
    return [{ tema, tono, quante: q }];
  });
  const rec = comeOggetto(comeOggetto(fatti)?.recensioni);
  const quandoTemi = [rec?.letto_il, quandoAd].find((d) => dataDiLetturaValida(d, adesso)) as string | undefined;
  if (quandoTemi) aggiungi('reputazione', pezzo(etichettaFonte('DataForSEO, temi delle recensioni pubbliche', quandoTemi), { temi }));

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
  aggiungi('concorrenti', sezioneAd(business, 'confronto_concorrenti', (o) => (prosa(o.differenza) ? voce(o.nome, prosa(o.differenza)) : voce(o.nome)), 5, ad));

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
  metti('social', b('instagram'), (x) => x.vuoto ? pezzo(x.etichetta, { frasi: ['Non abbiamo trovato un profilo Instagram dell’attività.'] }) : pezzo(x.etichetta, {
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
  aggiungi('calendario', sezioneAd(business, 'occasioni', (o) => voce(o.cosa, prosa(o.perche_conta)), 5, ad));

  // 9 · Soldi pubblici: i bandi trovati, e quelli che l'AD ha scelto per te.
  metti('bandi', b('bandi'), (x) => pezzo(x.etichetta, { voci: soloVoci(elenco(x.dati.elenco).slice(0, 6).map((e) => voce(comeOggetto(e)?.titolo))) }));
  aggiungi('bandi', sezioneAd(business, 'soldi_pubblici', (o) => voce(o.bando, [prosa(o.per_chi), typeof o.scadenza === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.scadenza) ? `scade il ${giornoEMese(`${o.scadenza}T12:00:00Z`)}` : null].filter(Boolean).join(' · ') || null), 4, ad));

  // 10 · Su MyCity: i numeri del negozio sono nella pagella, nella stessa pagina (flusso 18): qui non si ripetono.

  // 11 · Il piano dei 30 giorni, settimana per settimana.
  aggiungi('piano_30_giorni', sezioneAd(business, 'piano_30_giorni', (o) => {
    const s = intero(o.settimana, 4);
    // Contratto v1.3: `proposta` = cosa facciamo noi (10-160 caratteri), accanto all'azione.
    const proposta = typeof o.proposta === 'string' ? prosa(o.proposta, 10, 160) : null;
    const azione = typeof o.azione === 'string' ? fraseMostrabile(o.azione, 3, 200) : null;
    // Una settimana senza azione non si mostra: «Settimana 2» da sola non dice niente (revisione di mycity#336).
    if (!s || s < 1 || !azione || NOME_E_COGNOME.test(azione)) return null;
    return voce(`Settimana ${s}`, [azione, proposta ? `lo facciamo noi: ${proposta}` : null].filter(Boolean).join(' · '));
  }, 8, ad));

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
  aggiungi('concorrenti_web', sezioneAd(business, 'confronto_concorrenti', (o) => {
    const meglio = prosa(o.meglio);
    const peggio = prosa(o.peggio);
    return meglio || peggio ? voce(o.nome, [meglio ? `fa meglio: ${meglio}` : null, peggio ? `fa peggio: ${peggio}` : null].filter(Boolean).join(' · ')) : null;
  }, 5, ad));
  aggiungi('concorrenti_web', sezioneAd(business, 'idee_dal_confronto', (o) => (prosa(o.idea) ? voce(prosa(o.idea), prosa(o.perche)) : null), 3, ad));

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
  // Una riga salvata prima, o fuori contratto, si ripulisce come all'ingresso: al browser non arriva altro.
  const { fatti, business, ...resto } = analisiDaSalvare(analisi as Record<string, unknown>);
  const f = comeOggetto(fatti);
  const out: Record<string, unknown> = { ...resto };
  if (f) {
    const tenuti = Object.fromEntries(BLOCCHI_DELL_ASSAGGIO.filter((k) => k in f).map((k) => {
      const grezzo = comeOggetto(f[k]);
      if (!grezzo) return [k, null];
      const b = soloChiavi(grezzo, BUSTA_DEL_BLOCCO);
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
      // google: della busta solo il place_id, controllato.
      const d = comeOggetto(b.dati);
      return [k, { ...b, dati: typeof d?.place_id === 'string' && PLACE_ID.test(d.place_id) ? { place_id: d.place_id } : null }];
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
    nonComprende: ['Gli aggiornamenti del rapporto e il confronto mese su mese: ci sono nel Business e nel Premium.'],
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
      calendario: 'eventi e meteo, ogni mese',
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
  return (typeof fonte === 'string' && fonteDiGoogle(fonte)) || NUMERO_DI_GOOGLE.test(testo);
}

/**
 * Vero se l'indirizzo è di Google (Maps, Search, le sue immagini e API, i link brevi) o di TripAdvisor. Si guarda il
 * nome del sito letto dall'indirizzo, non il testo: «https://x@www.google.com/…» è Google (dal terzo collaudo).
 */
export function fonteDiGoogle(indirizzo: string): boolean {
  try {
    const host = new URL(indirizzo).hostname.toLowerCase();
    return HOST_GOOGLE.test(host);
  } catch {
    return /google|tripadvisor|goo\.gl/i.test(indirizzo);
  }
}
const HOST_GOOGLE = /(^|\.)(google\.[a-z.]{2,6}|googleapis\.com|googleusercontent\.com|gstatic\.com|ggpht\.com|goo\.gl|g\.page|g\.co|share\.google|goo\.gle|[a-z0-9-]+\.google|tripadvisor\.[a-z.]{2,6})$/;

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const LOCATION_ID = /^\d{1,20}$/;
/** Una fonte che è una pagina di Google Maps o TripAdvisor: un campo letto lì non si salva (parere legale del 26/11). */

/**
 * I campi della scheda come si salvano: un campo la cui fonte è Google Maps o TripAdvisor (orari, indirizzo,
 * telefono letti lì) non si salva, e nemmeno un campo con un nome che dice Google. Il titolare li scrive lui.
 */
export function campiDaSalvare<T extends Record<string, { fonte?: string | null } | undefined>>(campi: T): T {
  return Object.fromEntries(
    Object.entries(campi).filter(([nome, c]) => {
      if (CHIAVE_VIETATA.test(nome) || CHIAVE_DI_VOTO.test(nome)) return false;
      // Un campo senza fonte, o letto da Google, TripAdvisor o DataForSEO, non si salva (ricontrollo del 26/11).
      // Fanno eccezione gli stati che non vengono dal web (foto, frammento, proposta, nessuna): per natura non hanno
      // un indirizzo (collaudo finale: prima si perdevano il menu letto da una foto e le proposte).
      const stato = (c as { stato?: unknown } | undefined)?.stato;
      const senzaWeb = stato === 'foto' || stato === 'frammento' || stato === 'proposta' || stato === 'nessuna';
      const fonte = typeof c?.fonte === 'string' ? c.fonte.trim() : '';
      if (fonte ? fonteDiGoogle(fonte) || fonteDataForSeo(fonte) : !senzaWeb) return false;
      // Un valore che ricopia un voto o le recensioni («4,6 su 5 su Google») non si salva, qualunque sia il nome.
      const valore = (c as { valore?: unknown } | undefined)?.valore;
      return !(typeof valore === 'string' && (pareDatoDiGoogle(valore) || UN_VOTO.test(valore)));
    }),
  ) as T;
}

/** Le chiavi di `analisi` che il sito conosce e usa (scheda-cliente.ts, analisi.ts, offerta-su-misura.ts, qui). */
const CHIAVI_ANALISI = ['tipo_di_locale', 'pubblico', 'punti_di_forza', 'idee_contenuti', 'cosa_chiedere_al_titolare', 'dubbi', 'business', 'business_fatta_il', 'giudizio_sito', 'fatti'] as const;
const BLOCCHI_DEI_FATTI = ['posizione', 'vicini', 'meteo', 'eventi', 'bandi', 'sito', 'google', 'tripadvisor', 'recensioni', 'ricerche', 'instagram', 'concorrenti_canali'] as const;
const BUSTA_DEL_BLOCCO = ['stato', 'motivo', 'fonte', 'fonte_nome', 'licenza', 'letto_il', 'conserva_fino_al', 'dati', 'parte'] as const;
/** Le chiavi delle sezioni nuove dell'AD, dal contratto (sez. 2): tutto il resto non si salva. */
const VOCI_DELLE_SEZIONI: Record<string, readonly string[]> = {
  confronto_concorrenti: ['nome', 'distanza_m', 'differenza', 'fonte', 'meglio', 'peggio', 'fonte_canali'],
  idee_dal_confronto: ['idea', 'perche', 'servizio', 'fonte'],
  occasioni: ['quando', 'cosa', 'perche_conta', 'fonte'],
  soldi_pubblici: ['bando', 'ente', 'scadenza', 'per_chi', 'fonte'],
  piano_30_giorni: ['settimana', 'azione', 'servizio', 'proposta', 'fonte'],
};
/** Una chiave che dice un voto o recensioni («stelle», «rating», «numero_recensioni»): nei fatti non si salva. */
const CHIAVE_DI_VOTO = /voto|stell|rating|recension|review/i;
/** Una chiave che dice una persona (chi scrive, chi commenta): non si salva mai, da nessuna parte (revisione del 26/11). */
// Anche dentro nomi composti («autore_nome», «ultimo_commento», «display_name»): il collaudo finale ne ha trovati.
const CHIAVE_DI_PERSONA = /(^|_)(autore|autori|author|authors|utente|utenti|user|users|username|name|full|display|profile|commento|commenti|comment|comments|commentatori)(_|$)/i;
/** Le sezioni di prima dell'AD (analisi.ts, `SEZIONI_BUSINESS`) e le chiavi di ogni loro frase. */
const SEZIONI_DI_PRIMA = ['situazione', 'mercato', 'clienti', 'opportunita', 'rischi', 'prime_mosse'] as const;
const VOCE_DI_PRIMA = ['testo', 'fonte', 'servizio', 'proposta'] as const;
/** Il giudizio dell'AD sul sito (offerta-su-misura.ts, `leggiGiudizioSito`): solo queste chiavi. */
const CHIAVI_GIUDIZIO_SITO = ['livello', 'aspetto', 'pagine', 'nota', 'funzioni', 'migliorie'] as const;
const ELENCHI_DI_TESTO = ['punti_di_forza', 'idee_contenuti', 'cosa_chiedere_al_titolare', 'dubbi'] as const;

/** Un testo che non ricopia un voto o le recensioni di Google o TripAdvisor. */
const testoPulito = (v: unknown): v is string => typeof v === 'string' && !pareDatoDiGoogle(v);
/** Un testo descrittivo: oltre ai dati di Google, niente nomi di persona (ricontrollo di sicurezza del 26/11). */
const testoDescrittivo = (v: unknown): v is string => testoPulito(v) && !UN_VOTO.test(v) && !NOME_E_COGNOME.test(v);

/** Un indirizzo di DataForSEO. Il parere legale lo tiene solo per ricerche, posizioni e temi delle recensioni. */
export function fonteDataForSeo(indirizzo: unknown): boolean {
  if (typeof indirizzo !== 'string') return false;
  try {
    return /(^|\.)dataforseo\.com$/i.test(new URL(indirizzo).hostname);
  } catch {
    return /dataforseo/i.test(indirizzo);
  }
}
/** I soli blocchi dei fatti che possono venire da DataForSEO. */
const BLOCCHI_DA_DATAFORSEO = new Set(['ricerche', 'recensioni']);
/** Le chiavi di testo libero dentro i fatti: lì niente nomi di persona. I nomi di attività, eventi e bandi stanno in altre chiavi. */
const CHIAVE_DESCRITTIVA = /^(motivo|nota|note|descrizione|commento|osservazion[ie]|testo|perche|didascalia|caption)$/i;
const CHIAVE_INDIRIZZO = /^(fonte|link|indirizzo|url|profilo|parola|tipo_osm|orari_osm|data|letto_il)$/i;

/**
 * Le frasi dentro i fatti, non solo le chiavi: una stringa che ricopia un voto o le recensioni di Google si toglie;
 * in una chiave descrittiva (nota, motivo…) anche un nome di persona (ricontrollo di sicurezza del 26/11).
 */
function frasiPulite(v: unknown, chiave = '', profondita = 0): unknown {
  if (profondita > 8) return null;
  if (typeof v === 'string') {
    if (CHIAVE_INDIRIZZO.test(chiave)) return v;
    if (pareDatoDiGoogle(v) || UN_VOTO.test(v)) return null;
    return CHIAVE_DESCRITTIVA.test(chiave) && NOME_E_COGNOME.test(v) ? null : v;
  }
  if (Array.isArray(v)) return v.map((x) => frasiPulite(x, chiave, profondita + 1));
  const o = comeOggetto(v);
  if (!o) return v;
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, frasiPulite(x, k, profondita + 1)]));
}

const soloChiavi = (o: Record<string, unknown>, chiavi: readonly string[]) => Object.fromEntries(chiavi.filter((k) => k in o).map((k) => [k, o[k]]));

/** Toglie a ogni profondità le chiavi di voti e recensioni (i dati dentro i blocchi dei fatti). */
function senzaVoti(v: unknown, profondita = 0): unknown {
  if (profondita > 8) return null;
  if (Array.isArray(v)) return v.map((x) => senzaVoti(x, profondita + 1));
  const o = comeOggetto(v);
  if (!o) return v;
  return Object.fromEntries(Object.entries(o).filter(([k]) => !CHIAVE_DI_VOTO.test(k) && !CHIAVE_DI_PERSONA.test(k)).map(([k, x]) => [k, senzaVoti(x, profondita + 1)]));
}

/**
 * L'analisi come si salva, quando n8n manda la scheda (POST /api/agenzia/scheda-cliente). Parere legale del 26/11:
 * i dati di Google non si salvano, nemmeno per poco. Dal collaudo: non basta guardare il nome «google» delle
 * chiavi, si tiene SOLO quello che il contratto prevede. Quindi, prima di scrivere nel database:
 *  · di `analisi` solo le chiavi che il sito conosce; della vecchia bozza (`analisi.google`, `analisi.rapporto`) niente;
 *  · dei fatti solo i blocchi del contratto, con la loro busta; `google.dati` col solo `place_id` controllato,
 *    `tripadvisor.dati` col solo `location_id`, `recensioni.dati` coi soli conti (lette, con_risposta, ultima_il);
 *    dentro gli altri blocchi niente chiavi di voti o recensioni, né chiavi che dicono Google o TripAdvisor;
 *  · delle sezioni nuove dell'AD solo i campi del contratto; i temi della reputazione solo se reggono
 *    (`temaMostrabile`, tono noto, almeno 3 recensioni): un tema col nome o il testo di chi scrive non entra.
 * Le sezioni di prima dell'AD (situazione, mercato…) restano come sono: le ripulisce `analisiAziendale` in lettura.
 */
export function analisiDaSalvare<T extends Record<string, unknown> | undefined>(analisi: T): T {
  if (!analisi) return analisi;
  const a = soloChiavi(analisi as Record<string, unknown>, CHIAVI_ANALISI);

  const fg = comeOggetto(a.fatti);
  if (fg) {
    const f: Record<string, unknown> = soloChiavi(fg, ['versione', 'raccolti_il']);
    for (const k of BLOCCHI_DEI_FATTI) {
      const b = comeOggetto(fg[k]);
      if (!b) continue;
      const busta = frasiPulite(soloChiavi(b, BUSTA_DEL_BLOCCO)) as Record<string, unknown>;
      // DataForSEO vale solo per ricerche e recensioni: un blocco d'altro tipo letto da lì (orari, indirizzo presi da
      // Google attraverso DataForSEO) non si salva (ricontrollo di sicurezza del 26/11, parere legale).
      if (fonteDataForSeo(b.fonte) && !BLOCCHI_DA_DATAFORSEO.has(k)) continue;
      const d = comeOggetto(b.dati);
      let dati: unknown = null;
      if (d && k === 'google') dati = typeof d.place_id === 'string' && PLACE_ID.test(d.place_id.trim()) ? { place_id: d.place_id.trim() } : null;
      else if (d && k === 'tripadvisor') dati = typeof d.location_id === 'string' && LOCATION_ID.test(d.location_id.trim()) ? { location_id: d.location_id.trim() } : null;
      else if (d && k === 'recensioni') dati = soloChiavi(d, ['lette', 'con_risposta', 'ultima_il']);
      else if (d) dati = frasiPulite(senzaVoti(senzaChiaviVietate(d, [], true)));
      f[k] = { ...busta, dati };
    }
    a.fatti = f;
  }

  // I testi della lettura di n8n: niente voti o recensioni di Google ricopiati.
  // I testi della lettura di n8n: niente voti o recensioni di Google ricopiati, niente nomi di persona.
  for (const k of ['tipo_di_locale', 'pubblico'] as const) if (k in a && !testoDescrittivo(a[k])) delete a[k];
  for (const k of ELENCHI_DI_TESTO) if (k in a) a[k] = elenco(a[k]).filter(testoDescrittivo);

  // Il giudizio del sito: solo le sue chiavi, la nota senza dati di Google.
  const gs = comeOggetto(a.giudizio_sito);
  if ('giudizio_sito' in a) {
    if (!gs) delete a.giudizio_sito;
    else {
      const g = soloChiavi(gs, CHIAVI_GIUDIZIO_SITO);
      if ('nota' in g && !testoPulito(g.nota)) delete g.nota;
      if ('migliorie' in g) g.migliorie = Array.isArray(g.migliorie) ? g.migliorie.filter(testoPulito) : testoPulito(g.migliorie) ? g.migliorie : null;
      a.giudizio_sito = senzaVoti(g);
    }
  }

  // Le sezioni dell'AD: solo le chiavi conosciute (revisione del 26/11: lista bianca chiave per chiave).
  const bz = comeOggetto(a.business);
  if ('business' in a && !bz) delete a.business;
  if (bz) {
    const b2: Record<string, unknown> = {};
    for (const sezione of SEZIONI_DI_PRIMA) {
      if (!(sezione in bz)) continue;
      b2[sezione] = elenco(bz[sezione]).flatMap((x) => {
        const o = comeOggetto(x);
        if (!o) return [];
        const v = soloChiavi(o, VOCE_DI_PRIMA);
        return https(v.fonte) && !fonteDataForSeo(v.fonte) && typeof v.testo === 'string' && !pareDatoDiGoogle(v.testo, String(v.fonte)) ? [v] : [];
      });
    }
    for (const [sezione, chiavi] of Object.entries(VOCI_DELLE_SEZIONI)) {
      if (sezione in bz) b2[sezione] = elenco(bz[sezione]).flatMap((x) => {
        const o = comeOggetto(x);
        if (!o) return [];
        const v = senzaVoti(soloChiavi(o, chiavi)) as Record<string, unknown>;
        // Dal terzo collaudo: fonti solo https e non di Google o TripAdvisor; testi senza voti, recensioni o nomi
        // di persona (un testo storto si toglie; la voce resta se ha ancora la sua fonte).
        const fonte = https(v.fonte);
        if (!fonte || fonteDiGoogle(fonte) || fonteDataForSeo(fonte)) return [];
        v.fonte = fonte;
        if ('fonte_canali' in v) v.fonte_canali = https(v.fonte_canali) && !fonteDiGoogle(String(v.fonte_canali)) ? v.fonte_canali : null;
        for (const [k, val] of Object.entries(v)) {
          if (k === 'fonte' || k === 'fonte_canali' || typeof val !== 'string') continue;
          const nome = k === 'nome' || k === 'bando' || k === 'ente' || k === 'cosa';
          if (pareDatoDiGoogle(val) || UN_VOTO.test(val) || (!nome && NOME_E_COGNOME.test(val))) v[k] = null;
        }
        return [v];
      });
    }
    if ('reputazione_temi' in bz) {
      b2.reputazione_temi = elenco(bz.reputazione_temi).flatMap((x) => {
        const o = comeOggetto(x);
        const q = intero(o?.quante);
        const tono = o?.tono === 'positivo' || o?.tono === 'negativo' || o?.tono === 'misto' ? o.tono : null;
        const fonte = https(o?.fonte);
        // Mai una fonte di Google: «…/maps/contrib/<id>» è il profilo di chi ha scritto (ricontrollo del 26/11).
        return o && tono && fonte && !fonteDiGoogle(fonte) && temaMostrabile(o.tema) && q !== null && q >= RECENSIONI_MINIME_PER_TEMA ? [{ tema: o.tema, tono, quante: q, fonte }] : [];
      });
    }
    const parti = comeOggetto(bz.parti);
    if (parti) b2.parti = Object.fromEntries(Object.entries(parti).filter(([, n]) => intero(n, 12) !== null));
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
/**
 * In quali parti finisce ogni blocco dei fatti e ogni sezione dell'AD: la stessa mappa che usa `leggiRapporto`.
 * Un blocco esce dal server se almeno una delle sue parti è nella fascia (revisione di mycity#336: prima la mappa
 * era scritta a mano e mancavano `sito` e `vicini`).
 */
export const PARTI_DEI_BLOCCHI: Record<string, readonly ParteRapporto[]> = {
  vicini: ['concorrenti', 'zona'], sito: ['identita_online', 'sito'], instagram: ['social'], ricerche: ['ricerche'],
  eventi: ['calendario'], meteo: ['calendario'], bandi: ['bandi'], concorrenti_canali: ['concorrenti_web'],
  google: ['identita_online'], posizione: ['zona'], recensioni: ['reputazione'], tripadvisor: ['reputazione'],
};
export const PARTI_DELLE_SEZIONI: Record<string, readonly ParteRapporto[]> = {
  reputazione_temi: ['reputazione'], confronto_concorrenti: ['concorrenti', 'concorrenti_web'], occasioni: ['calendario'],
  soldi_pubblici: ['bandi'], piano_30_giorni: ['piano_30_giorni'], idee_dal_confronto: ['concorrenti_web'],
};
export const CONCORRENTI_WEB_PER_FASCIA: Record<Abbonamento, number> = { base: 0, business: 3, premium: 5 };
export function analisiPerLaFascia<T extends Record<string, unknown> | undefined>(analisi: T, fascia: Abbonamento | null): T {
  if (!analisi) return analisi;
  const parti = ANALISI_PER_FASCIA[fascia ?? 'base'].parti;
  const esclusa = (p: ParteRapporto | undefined) => !!p && parti[p] === null;
  const tuttaEsclusa = (ps: readonly ParteRapporto[] | undefined) => !!ps && ps.length > 0 && ps.every((p) => esclusa(p));
  // Una riga salvata prima, o fuori contratto, si ripulisce come all'ingresso (revisione del 26/11).
  const a = analisiDaSalvare({ ...(analisi as Record<string, unknown>) }) as Record<string, unknown>;
  const f = comeOggetto(a.fatti);
  if (f) {
    const tenuti: Record<string, unknown> = Object.fromEntries(Object.entries(f).filter(([k]) => !tuttaEsclusa(PARTI_DEI_BLOCCHI[k])));
    // Quanti concorrenti sui social e sul web: 3 nel Business, 5 nel Premium (`CONCORRENTI_WEB_PER_FASCIA`).
    const cc = comeOggetto(tenuti.concorrenti_canali);
    const d = comeOggetto(cc?.dati);
    if (cc && d) tenuti.concorrenti_canali = { ...cc, dati: { ...d, elenco: elenco(d.elenco).slice(0, CONCORRENTI_WEB_PER_FASCIA[fascia ?? 'base']) } };
    a.fatti = tenuti;
  }
  const b = comeOggetto(a.business);
  if (b) {
    // La mappa delle parti (`parti`) serve a n8n, non al browser.
    const b2 = Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'parti' && !tuttaEsclusa(PARTI_DELLE_SEZIONI[k])));
    // Il confronto coi concorrenti serve alla parte 3; «fa meglio / fa peggio» è della parte 12.
    if (Array.isArray(b2.idee_dal_confronto)) b2.idee_dal_confronto = b2.idee_dal_confronto.slice(0, 3);
    if (Array.isArray(b2.confronto_concorrenti) && !esclusa('concorrenti_web')) {
      // «Fa meglio / fa peggio» sui soli concorrenti della fascia.
      const quanti = CONCORRENTI_WEB_PER_FASCIA[fascia ?? 'base'];
      b2.confronto_concorrenti = b2.confronto_concorrenti.map((x, i) => {
        const o = comeOggetto(x);
        if (!o || i < quanti) return x;
        const { meglio: _m, peggio: _p, fonte_canali: _fc, ...resto } = o;
        return resto;
      });
    }
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

/* ───────────────────────── la scheda parziale aggiunge, non sostituisce ───────────────────────── */

const pieno = (v: unknown): boolean => {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  const o = comeOggetto(v);
  return o ? Object.keys(o).length > 0 : true;
};
const bloccoLetto = (v: unknown) => {
  const s = comeOggetto(v)?.stato;
  return s === 'letto' || s === 'vuoto';
};

/**
 * CONTRATTO v1.3, REGOLA 8 — Quando la ricerca si è fermata, il flusso manda `parziale: true`, `campi: {}` e solo le
 * parti dell'analisi che ha davvero. Il sito aggiunge quello che arriva e non scrive mai un vuoto sopra un pieno:
 *  · i campi e «da confermare» restano quelli di prima;
 *  · un blocco dei fatti nuovo prende il posto del vecchio, tranne quando il nuovo non è letto e il vecchio sì;
 *  · una sezione dell'analisi nuova prende il posto della vecchia solo se è piena.
 * Senza una scheda di prima, la parziale si salva com'è.
 */
export function unisciSchedaParziale(vecchia: SchedaCliente | null, nuova: SchedaCliente): SchedaCliente {
  if (!vecchia) return nuova;
  const va = (vecchia.analisi ?? {}) as Record<string, unknown>;
  const na = (nuova.analisi ?? {}) as Record<string, unknown>;
  const analisi: Record<string, unknown> = { ...va };
  for (const [k, v] of Object.entries(na)) {
    if (k === 'fatti') {
      const vf = comeOggetto(va.fatti) ?? {};
      const nf = comeOggetto(v) ?? {};
      const fatti: Record<string, unknown> = { ...vf };
      for (const [b, blocco] of Object.entries(nf)) {
        if (!pieno(blocco)) continue;
        if (bloccoLetto(vf[b]) && !bloccoLetto(blocco)) continue;
        fatti[b] = blocco;
      }
      analisi.fatti = fatti;
    } else if (k === 'business') {
      const vb = comeOggetto(va.business) ?? {};
      const nb = comeOggetto(v) ?? {};
      analisi.business = { ...vb, ...Object.fromEntries(Object.entries(nb).filter(([, x]) => pieno(x))) };
    } else if (pieno(v)) {
      analisi[k] = v;
    }
  }
  return { ...vecchia, ...nuova, campi: vecchia.campi, da_confermare: vecchia.da_confermare ?? [], analisi: analisi as SchedaCliente['analisi'] };
}
