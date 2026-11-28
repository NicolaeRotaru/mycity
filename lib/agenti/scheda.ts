// LA SCHEDA DEL CLIENTE — la stessa forma della scheda che scrive cervello/scheda-cliente.mjs
// (consegne/clienti/<cartella>/scheda.html), costruita in due tempi:
//   1. la PRIMA SCHEDA, in 2-4 secondi, dal programma: link, OpenStreetMap, misura del sito, le parti fisse;
//   2. la SCHEDA INTERA, quando l'AD ha cercato e giudicato (routine «Chiedi all'AD», piano Max).
// La risposta dell'AD passa sempre da `pulisci`: quello che non rispetta le regole si scarta e si dice.
// Il collaudo del 26/11 ha trovato frasi vietate che passavano con altre parole e campi mai controllati:
// adesso ogni testo dell'AD passa dagli stessi controlli (vedi `controllaTesto`).

import { SERVIZI_AGENZIA, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { CONDIZIONI, FASCE, ID_FASCE, PAGAMENTO, eFascia, type IdFascia } from './fasce';
import type { LettoDalLink } from './link';
import type { DatiOsm } from './osm';
import type { MisuraSito, LivelloSito } from './sito';
import { linkDelProfilo } from './profili';
import { indirizzoMaiLetto } from './mai-lette';
import type { CanaleDelVenditore } from './canale-venditore';

export type Stato = 'confermato' | 'da_confermare' | 'frammento' | 'non_trovato';
export const STATI: Record<Stato, string> = { confermato: 'Confermato', da_confermare: 'Da confermare', frammento: 'Solo un indizio', non_trovato: 'Non trovato' };
const FORZA: Record<Stato, number> = { confermato: 3, da_confermare: 2, frammento: 1, non_trovato: 0 };

export type Campo = { voce: string; valore: string | null; stato: Stato; fonte: string | null };
// 28/11/2026 — `venditore`: copiato dal venditore dalla scheda Google; `pagine`: trovato da n8n nelle pagine che l'AD ha visto.
export type Social = { canale: string; stato: 'trovato' | 'non_trovato'; livello: string | null; giudizio: string | null; fonte: string | null; origine?: 'sito' | 'mappa' | 'ad' | 'google' | 'venditore' | 'pagine' };
export type Concorrente = { nome: string; tipo: string | null; distanza: number; fonte: string };
/**
 * Cosa faremo per QUESTO negozio con una fascia (Nicola, 26/11/2026: «dentro ogni abbonamento deve esserci la
 * personalizzazione esatta del servizio che offriamo al cliente»): il perché, e una frase per ogni servizio.
 * La scrive l'AD; quello che l'AD non scrive lo compone il programma (lib/agenti/su-misura.ts).
 */
export type SuMisura = { perche: string | null; servizi: Partial<Record<ServizioAgenzia, string>> };

export type Scheda = {
  nome: string;
  tipo: string | null;
  citta: string;
  indirizzo: string | null;
  data: string;
  linkMaps: string | null;
  consigliato: IdFascia | null;
  perche_consigliato: string | null;
  in_30_secondi: string[];
  gancio: string | null;
  campi: Campo[];
  ha: string[];
  non_ha: string[];
  migliorare: string[];
  reputazione: { sintesi: string | null; positivi: string[]; negativi: string[] };
  sito: { livello: LivelloSito | 'non visto'; giudizio: string | null; fonte: string | null; misura: MisuraSito | null; daChi: 'AD' | 'programma' | null };
  social: Social[];
  concorrenti: Concorrente[];
  concorrentiContati: number;
  potenziale: string[];
  offerta: { servizio: string; perche: string }[];
  domande: string[];
  obiezioni: { obiezione: string; risposta: string }[];
  attenzione: string[];
  /** Per ogni fascia, cosa faremo per questo negozio: dall'AD. `null` finché l'AD non ha risposto. */
  su_misura: Partial<Record<IdFascia, SuMisura>> | null;
  fonti: { titolo: string; url: string }[];
  avvisi: string[];
  completa: boolean;
};

// ———————————————————————————————— attrezzi

export const httpsValido = (u: unknown): u is string => typeof u === 'string' && u.length <= 600 && /^https:\/\/[^\s"'<>]+$/.test(u);
/** Una pagina aperta davvero dal programma: va bene anche in http (il sito di un negozio può non essere protetto). */
const apertaDalProgramma = (u: unknown): u is string => typeof u === 'string' && u.length <= 600 && /^https?:\/\/[^\s"'<>]+$/.test(u);
const frase = (v: unknown, max = 400): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : null;
};
const elenco = (v: unknown, max: number, lung = 320): string[] =>
  (Array.isArray(v) ? v : []).map((x) => frase(x, lung)).filter((x): x is string => !!x).slice(0, max);
const dominio = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const dominioDi = (u: string | null | undefined) => { try { return new URL(String(u)).hostname.replace(/^(www\.|m\.)/, '').toLowerCase(); } catch { return ''; } };

// ———————————————————————————————— i paletti, in parole

const PERC = '(?:percentual\\w*|commission\\w*|provvigion\\w*)';
const FRASI_PERCENTUALE = [
  new RegExp(`\\b(?:nessuna|niente|zero|senza(?:\\s+(?:alcuna|nessuna))?)\\s+(?:di\\s+|la\\s+)?${PERC}`, 'gi'),
  new RegExp(`${PERC}\\s+(?:zero|a\\s+zero|0\\s*%)`, 'gi'),
  new RegExp(`\\b0\\s*%\\s+(?:di\\s+)?${PERC}`, 'gi'),
  new RegExp(`\\bnon\\s+(?:vi\\s+|ti\\s+|le\\s+|gli\\s+)?(?:chiediamo|prendiamo|tratteniamo|applichiamo|pagate|paghi|paga|c['’]è|ci\\s+sono)\\s+(?:più\\s+)?(?:nessuna\\s+|alcuna\\s+|il\\s+|la\\s+|le\\s+|una\\s+)?(?:10\\s*%|${PERC})`, 'gi'),
  /\b(?:il\s+)?10\s*%\s+(?:non\s+c['’]è\s+più|sparisce|scompare|non\s+si\s+paga|si\s+azzera|è\s+azzerat\w*|non\s+(?:si\s+)?applica)/gi,
];
/** Frasi dove dirlo è giusto: un avviso («mai dire…») o le vendite al banco, dove davvero non si prende niente. */
const AMMESSA_PRIMA = /\b(?:mai|non\s+dire|non\s+scrivere|evita(?:re)?|vietat\w*)\b[^.!?]{0,30}$/i;
const SUL_BANCO = /\bbanco\b/i;

/** Dice «niente percentuale» in qualche modo? (Il 10% sugli ordini fatti tramite MyCity resta sempre.) */
export function negaIlDieciPerCento(t: string): boolean {
  for (const re of FRASI_PERCENTUALE) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      const prima = t.slice(0, m.index ?? 0);
      const inizioFrase = Math.max(prima.lastIndexOf('.'), prima.lastIndexOf('!'), prima.lastIndexOf('?')) + 1;
      const fineFrase = t.slice(m.index ?? 0).search(/[.!?]/);
      const laFrase = t.slice(inizioFrase, fineFrase < 0 ? undefined : (m.index ?? 0) + fineFrase);
      if (AMMESSA_PRIMA.test(prima.slice(inizioFrase))) continue;
      if (SUL_BANCO.test(laFrase)) continue;
      return true;
    }
  }
  return false;
}
/** Per i test e per chi vuole un'espressione sola. */
export const NESSUNA_PERCENTUALE = { test: (t: string) => negaIlDieciPerCento(t) };

/** Gioco e tabacco: la pubblicità in Italia è vietata, quindi non entrano nelle proposte. */
export const GIOCO_TABACCO = /\b(?:sisal|snai|eurobet|lottomatica|bwin|betflag|goldbet|scommess\w*|superenalotto|ricevitori\w*|bingo|poker|vlt|tabacc\w*|sigarett\w*|sigar[oi]|iqos|svap\w*|e-?cig\w*)\b|\bgratta\s*(?:e|&)\s*vinci\b|\b10\s*e\s*lotto\b|\bgioc\w*\s+al\s+lotto\b|\bslot[\s-]?machine\b|\bslot\b(?!\s+(?:di|per|orar\w*|liber\w*))/i;
const EMAIL_IN_TESTO = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/i;
/** Le voci che parlano di persone: dati del titolare o dei dipendenti non entrano nella scheda. */
const VOCE_DI_PERSONA = /titolar|propriet|gestor\w*|soci[oa]?\b|fondat|dipendent|personale|chef|nome\s+(?:del|della|dei)\s/i;

// ———————————————————————————————— le parti fisse (valgono per tutti, scritte dalle regole firmate)

export const OBIEZIONI_FISSE: { chiave: RegExp; obiezione: string; risposta: string }[] = [
  { chiave: /percentual|10\s*%|commission|provvigion/i, obiezione: 'Poi mi prendete una percentuale.', risposta: 'Su quello che vendete al banco, niente. Sui prodotti venduti tramite MyCity c’è il 10%, anche con l’abbonamento: paga la consegna e il servizio.' },
  { chiave: /cost|prezz|car[oi]|tant[io]\s+soldi|euro|spes/i, obiezione: 'Costa troppo.', risposta: 'Il primo mese costa la metà e non c’è vincolo: si disdice con 30 giorni di preavviso. Si può partire dal Base a 300 euro al mese e salire quando si vede il risultato.' },
  { chiave: /tempo|social.*(non|mai)|non so usare/i, obiezione: 'Non ho tempo per i social.', risposta: 'Non serve: foto e testi li prepariamo noi, voi approvate l’anteprima su WhatsApp. Nessuna app nuova da imparare.' },
];

export const ATTENZIONE_FISSE = [
  'Il 10% sui prodotti venduti tramite MyCity resta anche con l’abbonamento: dillo subito, mai «nessuna percentuale». Sulle vendite al banco non si prende niente.',
  'Questa scheda è solo per te: non mostrarla e non mandarla al titolare.',
];

// ———————————————————————————————— 1. la prima scheda, dal programma

export function primaScheda({ letto, osm, misura, citta, data, venditore = null }: {
  letto: LettoDalLink; osm: DatiOsm | null; misura: MisuraSito | null; citta: string; data: string;
  /** 28/11/2026 — Quello che il venditore ha copiato dalla scheda Google, e se il sito che ha scritto non si è potuto confermare. */
  venditore?: { canale: CanaleDelVenditore | null; sitoNonConfermato?: string | null } | null;
}): Scheda {
  const nome = letto.nome || osm?.luogo?.nome || 'Attività senza nome';
  const campi: Campo[] = [];
  const linkMaps = httpsValido(letto.link) ? letto.link : null;
  campi.push({ voce: 'Nome', valore: nome, stato: letto.nome ? 'da_confermare' : osm?.luogo ? 'da_confermare' : 'frammento', fonte: letto.nome ? linkMaps : osm?.luogo?.fonte ?? null });
  const indirizzo = letto.indirizzo || osm?.indirizzo?.testo || null;
  if (letto.indirizzo) campi.push({ voce: 'Indirizzo', valore: letto.indirizzo, stato: 'da_confermare', fonte: linkMaps });
  else if (osm?.indirizzo) campi.push({ voce: 'Indirizzo', valore: osm.indirizzo.testo, stato: 'da_confermare', fonte: osm.indirizzo.fonte });
  const l = osm?.luogo;
  if (l?.tipo) campi.push({ voce: 'Tipo (sulla mappa libera)', valore: l.tipo, stato: 'da_confermare', fonte: l.fonte });
  if (l?.telefono) campi.push({ voce: 'Telefono dell’attività', valore: l.telefono, stato: 'da_confermare', fonte: l.fonte });
  if (l?.orari) campi.push({ voce: 'Orari (sulla mappa libera)', valore: l.orari, stato: 'frammento', fonte: l.fonte });
  const social: Social[] = [];
  const sitoAperto = misura?.aperto && apertaDalProgramma(misura.url) ? misura : null;
  if (sitoAperto) {
    const m = sitoAperto;
    const fatti = [`${m.pagine} ${m.pagine === 1 ? 'pagina' : 'pagine'} collegate dalla home`, m.https === false ? 'non protetto (solo http)' : m.https ? 'protetto (https)' : null,
      m.telefonino ? 'pensato per il telefono' : 'non pensato per il telefono', m.piattaforma ? `fatto con ${m.piattaforma}` : null,
      m.anno ? `anno in fondo alla pagina: ${m.anno}` : null].filter(Boolean).join(' · ');
    // 28/11/2026 — Un sito riconosciuto solo dal nome può essere di un omonimo: si mostra, da controllare.
    const soloNome = m.prova === 'nome';
    campi.push({ voce: 'Sito', valore: `${dominio(m.url)} — ${fatti}${soloNome ? ' (trovato dal nome: controlla che sia il suo; se lo è, copialo nel campo «sito o Instagram»)' : ''}`, stato: soloNome ? 'da_confermare' : 'confermato', fonte: m.url });
    if (m.funzioni.length) campi.push({ voce: 'Sul sito si trova', valore: m.funzioni.join(', '), stato: 'confermato', fonte: m.url });
    if (m.titolo) campi.push({ voce: 'Titolo del sito su Google', valore: `«${m.titolo}»`, stato: 'confermato', fonte: m.url });
  } else if (l?.sito) {
    campi.push({ voce: 'Sito', valore: `${l.sito} (scritto sulla mappa libera; non si apre da qui${misura?.errore ? `: ${misura.errore}` : ''})`, stato: 'frammento', fonte: l.fonte });
  }
  if (venditore?.sitoNonConfermato) {
    campi.push({ voce: 'Sito scritto da te', valore: `${venditore.sitoNonConfermato} (non si apre, oppure la pagina non porta il nome e la città del locale: controllalo)`, stato: 'frammento', fonte: null });
  }
  // I profili: prima quelli collegati dal sito stesso (confermati), poi quelli della mappa libera, solo se il
  // link porta davvero a quel social (sulla mappa chiunque può scrivere qualunque indirizzo).
  const DOMINI: Record<string, string> = { Instagram: 'instagram.com', Facebook: 'facebook.com', TikTok: 'tiktok.com' };
  const profilo = (canale: string, daSito?: string, daOsm?: string | null) => {
    if (daSito && sitoAperto) social.push({ canale, stato: 'trovato', livello: 'da vedere', giudizio: 'Il sito dell’attività porta a questo profilo. Ritmo e video li guarda l’AD.', fonte: daSito, origine: 'sito' });
    else if (daOsm && httpsValido(daOsm) && dominioDi(daOsm) === DOMINI[canale]) social.push({ canale, stato: 'trovato', livello: 'da vedere', giudizio: 'Profilo scritto sulla mappa libera: da controllare.', fonte: daOsm, origine: 'mappa' });
  };
  profilo('Instagram', sitoAperto?.social.instagram, l?.instagram);
  profilo('Facebook', sitoAperto?.social.facebook, l?.facebook);
  profilo('TikTok', sitoAperto?.social.tiktok, null);
  // Il profilo copiato dal venditore dalla scheda Google: vale come trovato, se il sito non ne collega già uno.
  const dalVenditore: [string, 'Instagram' | 'Facebook' | 'TikTok'][] = [[venditore?.canale?.instagram ?? '', 'Instagram'], [venditore?.canale?.facebook ?? '', 'Facebook'], [venditore?.canale?.tiktok ?? '', 'TikTok']];
  for (const [nomeProfilo, canale] of dalVenditore) {
    if (!nomeProfilo || social.some((p) => p.canale === canale && p.origine === 'sito')) continue;
    const i = social.findIndex((p) => p.canale === canale);
    const voce: Social = { canale, stato: 'trovato', livello: 'da vedere', giudizio: 'L’hai copiato tu dalla scheda Google. Ritmo e video li guarda l’AD.', fonte: linkDelProfilo(canale, nomeProfilo), origine: 'venditore' };
    if (i < 0) social.push(voce); else social[i] = voce;
  }
  social.push({ canale: 'Scheda Google Maps', stato: 'trovato', livello: 'da vedere', origine: 'google',
    giudizio: 'C’è: è il link che hai incollato. Voto, numero di recensioni, foto e orari guardali dal telefono prima di entrare.', fonte: linkMaps });
  const tipo = l?.tipo ?? null;
  const gioco = GIOCO_TABACCO.test(`${tipo ?? ''} ${nome}`);
  return {
    nome, tipo, citta, indirizzo, data, linkMaps,
    consigliato: null, perche_consigliato: null, in_30_secondi: [], gancio: null,
    campi, ha: [], non_ha: [], migliorare: [],
    reputazione: { sintesi: null, positivi: [], negativi: [] },
    sito: sitoAperto
      ? { livello: sitoAperto.stima, giudizio: null, fonte: sitoAperto.url, misura: sitoAperto, daChi: 'programma' }
      : { livello: 'non visto', giudizio: null, fonte: null, misura, daChi: null },
    social,
    concorrenti: osm?.concorrenti ?? [], concorrentiContati: osm?.concorrentiContati ?? 0,
    potenziale: [], offerta: [], domande: [],
    obiezioni: OBIEZIONI_FISSE.map(({ obiezione, risposta }) => ({ obiezione, risposta })),
    attenzione: [...ATTENZIONE_FISSE, ...(gioco ? ['Niente gioco (Sisal, scommesse, gratta e vinci) né tabacco nei contenuti proposti: in Italia la pubblicità è vietata.'] : [])],
    su_misura: null,
    fonti: [], avvisi: [...(osm?.avvisi ?? [])],
    completa: false,
  };
}

/**
 * Una prima scheda letta dalla tabella n8n, con ogni parte al suo posto: una scheda salvata con una forma più
 * vecchia (o storta) non fa saltare la pagina. `null` se non è nemmeno riconoscibile.
 */
export function normalizza(x: unknown): Scheda | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Partial<Scheda> & Record<string, unknown>;
  if (typeof s.nome !== 'string' || !s.nome.trim()) return null;
  const lista = <T,>(v: unknown, ok: (e: unknown) => e is T) => (Array.isArray(v) ? v.filter(ok) : []);
  const testi = (v: unknown) => lista(v, (e): e is string => typeof e === 'string');
  const campi = lista(s.campi, (c): c is Campo => !!c && typeof c === 'object' && typeof (c as Campo).voce === 'string' && (c as Campo).stato in STATI);
  const social = lista(s.social, (c): c is Social => !!c && typeof c === 'object' && typeof (c as Social).canale === 'string');
  const sito = (s.sito && typeof s.sito === 'object' ? s.sito : {}) as Partial<Scheda['sito']>;
  const rep = (s.reputazione && typeof s.reputazione === 'object' ? s.reputazione : {}) as Partial<Scheda['reputazione']>;
  return {
    nome: s.nome, tipo: typeof s.tipo === 'string' ? s.tipo : null, citta: typeof s.citta === 'string' ? s.citta : 'Piacenza',
    indirizzo: typeof s.indirizzo === 'string' ? s.indirizzo : null, data: typeof s.data === 'string' ? s.data : '',
    linkMaps: httpsValido(s.linkMaps) ? s.linkMaps : null,
    consigliato: eFascia(s.consigliato) ? s.consigliato : null, perche_consigliato: typeof s.perche_consigliato === 'string' ? s.perche_consigliato : null,
    in_30_secondi: testi(s.in_30_secondi), gancio: typeof s.gancio === 'string' ? s.gancio : null,
    campi, ha: testi(s.ha), non_ha: testi(s.non_ha), migliorare: testi(s.migliorare),
    reputazione: { sintesi: typeof rep.sintesi === 'string' ? rep.sintesi : null, positivi: testi(rep.positivi), negativi: testi(rep.negativi) },
    sito: {
      livello: (['nessuno', 'semplice', 'medio', 'pregio', 'non visto'] as const).includes(sito.livello as never) ? (sito.livello as Scheda['sito']['livello']) : 'non visto',
      giudizio: typeof sito.giudizio === 'string' ? sito.giudizio : null, fonte: apertaDalProgramma(sito.fonte) ? sito.fonte : null,
      misura: sito.misura && typeof sito.misura === 'object' && Array.isArray((sito.misura as MisuraSito).funzioni) ? (sito.misura as MisuraSito) : null,
      daChi: sito.daChi === 'AD' || sito.daChi === 'programma' ? sito.daChi : null,
    },
    social,
    concorrenti: lista(s.concorrenti, (c): c is Concorrente => !!c && typeof c === 'object' && typeof (c as Concorrente).nome === 'string' && typeof (c as Concorrente).distanza === 'number'),
    concorrentiContati: typeof s.concorrentiContati === 'number' ? s.concorrentiContati : 0,
    potenziale: testi(s.potenziale),
    offerta: lista(s.offerta, (o): o is { servizio: string; perche: string } => !!o && typeof o === 'object' && typeof (o as { servizio: unknown }).servizio === 'string' && typeof (o as { perche: unknown }).perche === 'string'),
    domande: testi(s.domande),
    obiezioni: lista(s.obiezioni, (o): o is { obiezione: string; risposta: string } => !!o && typeof o === 'object' && typeof (o as { obiezione: unknown }).obiezione === 'string' && typeof (o as { risposta: unknown }).risposta === 'string'),
    attenzione: testi(s.attenzione),
    su_misura: leggiSuMisura(s.su_misura, () => true),
    fonti: lista(s.fonti, (f): f is { titolo: string; url: string } => !!f && typeof f === 'object' && typeof (f as { titolo: unknown }).titolo === 'string' && apertaDalProgramma((f as { url: unknown }).url)),
    avvisi: testi(s.avvisi), completa: s.completa === true,
  };
}

// ———————————————————————————————— 2. la risposta dell'AD, ripulita

/**
 * Le promesse che una fascia non mantiene (il compito: «non promettere quello che la fascia non dà»), frase per frase.
 * Il collaudo del 27/11 ha trovato il primo controllo bucato: bastava un «non» in un punto qualsiasi della frase.
 * Adesso la negazione conta solo nelle 5 parole prima della promessa («niente video»); una frase che nomina una
 * fascia più alta («i video arrivano dal Business») o descrive com'è il negozio oggi («oggi pubblica due video»)
 * non promette; i numeri di post e video si confrontano col listino della fascia.
 */
const NUMERI: Record<string, number> = { zero: 0, un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20, trenta: 30 };
const numero = (w: string | undefined): number | undefined => (w === undefined ? undefined : /^\d+$/.test(w) ? Number(w) : NUMERI[w]);
const NEGAZIONE = new Set(['senza', 'niente', 'non', 'nessun', 'nessuno', 'nessuna', 'né']);
const SOPRA: Record<IdFascia, RegExp | null> = {
  base: /\b(?:dal|col|nel|con\s+il|al|il|del|un|il\s+piano)\s+(?:business|premium)\b/i,
  business: /\b(?:dal|col|nel|con\s+il|al|il|del|un)\s+premium\b/i,
  premium: null,
};
const DI = new Set(['del', 'della', 'dei', 'delle', 'degli', 'di', 'dello']);
export function promessaFuoriFascia(id: IdFascia, t: string): boolean {
  const sopra = SOPRA[id];
  if (!sopra) return false;
  const f = FASCE[id];
  for (const pezzo of t.split(/[.;:!?]+/)) {
    if (!pezzo.trim()) continue;
    if (/\boggi\b/i.test(pezzo) && !/\bda\s+oggi\b/i.test(pezzo)) continue; // descrive com'è oggi
    if (sopra.test(pezzo)) continue; // la mette a confronto con una fascia più alta
    const w = pezzo.toLowerCase().split(/\s+/).map((x) => x.replace(/[^\p{L}\d]/gu, '')).filter(Boolean);
    const negata = (i: number) => w.slice(Math.max(0, i - 5), i).some((x) => NEGAZIONE.has(x));
    const fuori = (i: number) => !negata(i);
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      const quanti = numero(w[i - 1]);
      if ((x === 'video' || x === 'reel' || x === 'reels') && fuori(i)) {
        if (f.video === 0 && quanti !== 0) return true;
        if (quanti !== undefined && quanti > f.video) return true;
      }
      if ((x === 'post' || x === 'contenuti') && quanti !== undefined && quanti > f.post && fuori(i)) return true;
      if ((x === 'storie' || x === 'stories' || x === 'story') && fuori(i)) {
        const racconto = DI.has(w[i + 1] ?? '') && !/^(?:instagram|facebook|tiktok)$/.test(w[i + 2] ?? '');
        if (!racconto) return true;
      }
      if (x === 'referente' && fuori(i)) return true;
      if (x === 'persona' && /^(?:dedicata|tutta)$/.test(w[i + 1] ?? '') && fuori(i)) return true;
      if (x === 'visita' && /^(?:una|la|nostra)$/.test(w[i - 1] ?? '') && fuori(i)) return true;
      if (x === 'trovarvi' && fuori(i)) return true;
      if (/^pass(?:a|iamo|eremo)$/.test(x) && /^(?:in|da)$/.test(w[i + 1] ?? '') && /^(?:voi|negozio|bottega|locale|pasticceria|forno|bar|laboratorio)$/.test(w[i + 2] ?? '') && fuori(i)) return true;
      if ((x === 'incontro' || x === 'incontri') && fuori(i)) return true;
      if (id === 'base') {
        if (x === 'pagine' && (w[i - 1] === 'più' || (numero(w[i - 1]) ?? 0) >= 2) && fuori(i)) return true;
        if (/^(?:risposte|rispondiamo|risponderemo)$/.test(x) && w.slice(i + 1, i + 4).includes('recensioni') && fuori(i)) return true;
      }
    }
    const diAnalisi = /\b(?:analisi|rapporto|concorrent\w*)\b/i.test(pezzo);
    if (diAnalisi && id === 'base' && /\bogni\s+(?:mese|settimana)\b|\bsettimanal\w*|\bmensil\w*/i.test(pezzo)) return true;
    if (diAnalisi && id === 'business' && /\bogni\s+settimana\b|\bsettimanal\w*/i.test(pezzo)) return true;
  }
  return false;
}

const NOMI_SERVIZI: Record<ServizioAgenzia, string> = { foto_video: 'foto e video', sito_web: 'sito', social: 'social e Google', analisi: 'analisi' };

/** La parte «su misura» di ogni fascia: solo testi, solo le fasce e i servizi che esistono; `passa` fa i controlli. */
export function leggiSuMisura(v: unknown, passa: (t: string, dove: string, id: IdFascia) => boolean): Partial<Record<IdFascia, SuMisura>> | null {
  if (!v || typeof v !== 'object') return null;
  const tutto = v as Record<string, unknown>;
  const fuori: Partial<Record<IdFascia, SuMisura>> = {};
  for (const id of ID_FASCE) {
    const x = (tutto[id] && typeof tutto[id] === 'object' ? tutto[id] : null) as Record<string, unknown> | null;
    if (!x) continue;
    const dove = (cosa: string) => `su misura del ${FASCE[id].nome} (${cosa})`;
    const t = (w: unknown, cosa: string, max: number) => { const f = frase(w, max); return f && passa(f, dove(cosa), id) ? f : null; };
    const servizi: Partial<Record<ServizioAgenzia, string>> = {};
    // La forma della risposta dell'AD (`x.foto_video`) e quella della scheda già unita (`x.servizi.foto_video`).
    const dentro = (x.servizi && typeof x.servizi === 'object' ? x.servizi : {}) as Record<string, unknown>;
    for (const sv of SERVIZI_AGENZIA) { const f = t(x[sv] ?? dentro[sv], NOMI_SERVIZI[sv], 360); if (f) servizi[sv] = f; }
    const perche = t(x.perche, 'perché', 400);
    if (perche || Object.keys(servizi).length) fuori[id] = { perche, servizi };
  }
  return Object.keys(fuori).length ? fuori : null;
}

const STATI_AMMESSI = new Set<Stato>(['confermato', 'da_confermare', 'frammento', 'non_trovato']);
const LIVELLI_SITO = new Set(['nessuno', 'semplice', 'medio', 'pregio']);
const CANALI = new Set(['Instagram', 'Facebook', 'TikTok']);

/** `pagine` (28/11/2026): le pagine dei risultati che l'AD ha visto, da aprire per cercarci sito e profili (lib/agenti/conferma-ad.ts). */
export type RispostaPulita = Partial<Omit<Scheda, 'sito'>> & { sito?: { livello?: LivelloSito; giudizio?: string | null; fonte?: string | null; url?: string | null }; pagine?: string[]; scartati: string[] };


export function pulisci(grezza: unknown): RispostaPulita {
  const r = (grezza && typeof grezza === 'object' ? grezza : {}) as Record<string, unknown>;
  const scartati: string[] = [];
  /** Il controllo di ogni testo dell'AD: il 10% (sempre), le email (sempre), gioco e tabacco (nelle proposte). */
  const passa = (t: string, dove: string, proposta = false) => {
    if (negaIlDieciPerCento(t)) { scartati.push(`${dove}: una frase diceva che non c’è la percentuale, ma il 10% sui prodotti venduti tramite MyCity resta`); return false; }
    if (EMAIL_IN_TESTO.test(t)) { scartati.push(`${dove}: una frase con un indirizzo email`); return false; }
    if (proposta && GIOCO_TABACCO.test(t)) { scartati.push(`${dove}: una proposta parlava di gioco o tabacco, che non si pubblicizzano`); return false; }
    return true;
  };
  const testo = (v: unknown, dove: string, max = 400, proposta = false) => { const t = frase(v, max); return t && passa(t, dove, proposta) ? t : null; };
  const testi = (v: unknown, max: number, dove: string, proposta = false, lung = 320) => elenco(v, max, lung).filter((x) => passa(x, dove, proposta));

  const campi: Campo[] = [];
  for (const c of Array.isArray(r.campi) ? r.campi.slice(0, 16) : []) {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const voce = frase(x.voce, 60);
    const stato = STATI_AMMESSI.has(x.stato as Stato) ? (x.stato as Stato) : null;
    if (!voce || !stato) { scartati.push(`un dato senza voce o con uno stato non ammesso («${String(x.stato ?? '')}»)`); continue; }
    if (/^nome$/i.test(voce)) continue; // il nome dell'attività lo scrive il programma, dal link del venditore
    if (VOCE_DI_PERSONA.test(voce)) { scartati.push(`«${voce}»: dati di persone non entrano nella scheda`); continue; }
    if (stato === 'non_trovato') { campi.push({ voce, valore: null, stato, fonte: null }); continue; }
    if (!httpsValido(x.fonte)) { scartati.push(`«${voce}»: dato senza una fonte https`); continue; }
    const valore = testo(x.valore, `«${voce}»`, 300);
    if (!valore) { if (!frase(x.valore)) scartati.push(`«${voce}»: dato vuoto`); continue; }
    campi.push({ voce, valore, stato, fonte: x.fonte });
  }
  const social: Social[] = [];
  for (const s of Array.isArray(r.social) ? r.social.slice(0, 6) : []) {
    const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const canale = frase(x.canale, 30);
    if (!canale || !CANALI.has(canale)) continue; // la scheda Google la scrive il programma
    const trovato = x.stato === 'trovato';
    if (trovato && !httpsValido(x.fonte)) { scartati.push(`${canale}: profilo senza una fonte https`); continue; }
    const extra = [typeof x.post_al_mese === 'number' && x.post_al_mese >= 0 ? `circa ${Math.round(x.post_al_mese)} post al mese` : null,
      x.video === true ? 'con video' : x.video === false ? 'senza video' : null].filter(Boolean).join(', ');
    const giudizio = [testo(x.giudizio, canale, 280), extra ? `(${extra})` : null].filter(Boolean).join(' ') || null;
    social.push({ canale, stato: trovato ? 'trovato' : 'non_trovato', livello: frase(x.livello, 30), giudizio, fonte: trovato ? (x.fonte as string) : null, origine: 'ad' });
  }
  const sitoR = (r.sito && typeof r.sito === 'object' ? r.sito : {}) as Record<string, unknown>;
  const sito = {
    livello: LIVELLI_SITO.has(String(sitoR.livello)) ? (sitoR.livello as LivelloSito) : undefined,
    giudizio: testo(sitoR.giudizio, 'giudizio sul sito'),
    fonte: httpsValido(sitoR.fonte) ? sitoR.fonte : null,
    url: httpsValido(sitoR.url) ? sitoR.url : null,
  };
  const pagine = [...new Set((Array.isArray(r.pagine_viste) ? r.pagine_viste : []).filter((u): u is string => httpsValido(u) && !indirizzoMaiLetto(u)))].slice(0, 4);
  const rep = (r.reputazione && typeof r.reputazione === 'object' ? r.reputazione : {}) as Record<string, unknown>;
  const consigliato: IdFascia | null = eFascia(r.consigliato) ? r.consigliato : null;
  if (r.consigliato != null && !consigliato) scartati.push(`abbonamento consigliato sconosciuto («${String(r.consigliato)}»)`);
  const offerta = (Array.isArray(r.offerta) ? r.offerta.slice(0, 5) : [])
    .map((o) => { const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>; return { servizio: frase(x.servizio, 60), perche: frase(x.perche, 320) }; })
    .filter((o): o is { servizio: string; perche: string } => !!o.servizio && !!o.perche)
    .filter((o) => passa(`${o.servizio}. ${o.perche}`, 'offerta', true));
  const obiezioni = (Array.isArray(r.obiezioni) ? r.obiezioni.slice(0, 4) : [])
    .map((o) => { const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>; return { obiezione: frase(x.obiezione, 160), risposta: frase(x.risposta, 360) }; })
    .filter((o): o is { obiezione: string; risposta: string } => !!o.obiezione && !!o.risposta)
    .filter((o) => passa(o.obiezione, 'obiezioni') && passa(o.risposta, 'obiezioni', true));
  return {
    tipo: testo(r.tipo, 'tipo', 120) ?? undefined,
    consigliato,
    perche_consigliato: testo(r.perche_consigliato, 'perché dell’abbonamento', 600, true),
    in_30_secondi: testi(r.in_30_secondi, 5, 'in 30 secondi', true),
    gancio: testo(r.gancio, 'gancio', 360, true),
    campi, social,
    ha: testi(r.ha, 6, 'ha'),
    non_ha: testi(r.non_ha, 6, 'non ha'),
    migliorare: testi(r.migliorare, 5, 'da migliorare', true),
    reputazione: { sintesi: testo(rep.sintesi, 'reputazione', 500), positivi: testi(rep.positivi, 4, 'reputazione'), negativi: testi(rep.negativi, 4, 'reputazione') },
    sito,
    pagine,
    potenziale: testi(r.potenziale, 5, 'potenziale', true),
    offerta, obiezioni,
    domande: testi(r.domande, 7, 'domande'),
    attenzione: testi(r.attenzione, 5, 'attenzione'),
    su_misura: leggiSuMisura(r.su_misura, (t, dove, id) => {
      if (!passa(t, dove, true)) return false;
      if (promessaFuoriFascia(id, t)) { scartati.push(`${dove}: prometteva una cosa che il ${FASCE[id].nome} non dà (video, storie, più pagine, referente o visite)`); return false; }
      return true;
    }),
    scartati,
  };
}

// ———————————————————————————————— 3. l'unione: la prima scheda più la risposta dell'AD

export function unisci(prima: Scheda, adGrezzo: RispostaPulita, avvisiAd: string[] = []): Scheda {
  const s: Scheda = structuredClone(prima);
  let ad = adGrezzo;
  if (ad.tipo) s.tipo = ad.tipo;
  s.consigliato = ad.consigliato ?? null;
  s.perche_consigliato = ad.perche_consigliato ?? null;
  s.in_30_secondi = ad.in_30_secondi ?? [];
  s.gancio = ad.gancio ?? null;
  // I dati: quelli del programma restano; un dato dell'AD con la stessa voce vince solo se è più sicuro.
  const chiave = (v: string) => v.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-zà-ú]+/g, ' ').trim();
  for (const c of ad.campi ?? []) {
    const i = s.campi.findIndex((x) => chiave(x.voce) === chiave(c.voce));
    if (i < 0) s.campi.push(c);
    else if (FORZA[c.stato] > FORZA[s.campi[i].stato]) s.campi[i] = c;
  }
  // I profili: un profilo trovato dal programma resta; l'AD aggiunge il ritmo e quelli che mancano.
  for (const p of ad.social ?? []) {
    const i = s.social.findIndex((x) => x.canale === p.canale);
    const google = s.social.findIndex((x) => x.canale === 'Scheda Google Maps');
    if (i < 0) s.social.splice(google < 0 ? s.social.length : google, 0, p);
    // Il profilo del sito o quello copiato dal venditore resta suo: l'AD aggiunge solo il giudizio.
    else if (p.stato === 'trovato') {
      const tieni = s.social[i].origine === 'sito' || s.social[i].origine === 'venditore';
      s.social[i] = { ...p, fonte: tieni ? s.social[i].fonte : p.fonte ?? s.social[i].fonte, origine: tieni ? s.social[i].origine : 'ad' };
    }
    // «non trovato» dall'AD non cancella un profilo che il programma ha visto.
  }
  // Il programma ha aperto il sito: se l'AD dice che non c'è, ha visto solo gli estratti della ricerca.
  const sitoVisto = !!prima.sito.misura?.aperto;
  if (sitoVisto && ad.sito?.livello === 'nessuno') {
    s.avvisi.push('L’AD non aveva visto il sito che il programma ha aperto: vale la misura del programma.');
    ad = { ...ad, sito: { ...ad.sito, livello: undefined, giudizio: null } };
  }
  const profiliDalSito = prima.social.filter((p) => p.stato === 'trovato' && (p.origine === 'sito' || p.origine === 'venditore')).map((p) => p.canale.toLowerCase());
  const nonHa = (ad.non_ha ?? []).filter((x) => {
    if (profiliDalSito.length && (/social|profil/i.test(x) || profiliDalSito.some((c) => x.toLowerCase().includes(c)))) { s.avvisi.push(`Tolto da «Non ha»: «${x}» (i profili ci sono: li collega il sito dell’attività o li ha copiati il venditore).`); return false; }
    if (sitoVisto && /\bsito\b/i.test(x) && /(trovat|in rete|nessun|non ha)/i.test(x)) { s.avvisi.push(`Tolto da «Non ha»: «${x}» (il programma ha aperto il sito).`); return false; }
    return true;
  });
  ad = { ...ad, non_ha: nonHa };
  s.ha = ad.ha ?? []; s.non_ha = ad.non_ha ?? []; s.migliorare = ad.migliorare ?? [];
  if (ad.reputazione) s.reputazione = ad.reputazione as Scheda['reputazione'];
  if (ad.sito) {
    if (ad.sito.livello) { s.sito.livello = ad.sito.livello; s.sito.daChi = 'AD'; }
    s.sito.giudizio = ad.sito.giudizio ?? s.sito.giudizio;
    s.sito.fonte = ad.sito.fonte ?? s.sito.fonte;
  }
  if (s.sito.livello === 'non visto' && !ad.sito?.livello) s.sito.livello = 'medio'; // tabella firmata: sito non guardato = medio
  s.potenziale = ad.potenziale ?? [];
  s.offerta = ad.offerta ?? [];
  s.domande = ad.domande ?? [];
  // Le obiezioni: prima quelle su misura dell'AD, poi le fisse che l'AD non ha già coperto.
  const suMisura = ad.obiezioni ?? [];
  s.obiezioni = [...suMisura, ...OBIEZIONI_FISSE.filter((f) => !suMisura.some((o) => f.chiave.test(o.obiezione))).map(({ obiezione, risposta }) => ({ obiezione, risposta }))];
  s.attenzione = [...new Set([...prima.attenzione, ...(ad.attenzione ?? [])])];
  s.su_misura = ad.su_misura ?? null;
  const avvisiVeri = avvisiAd.map((a) => frase(a, 240)).filter((a): a is string => !!a).slice(0, 5);
  s.avvisi = [...s.avvisi, ...avvisiVeri.map((a) => `L’AD avvisa: ${a}`), ...(ad.scartati ?? []).map((x) => `Scartato: ${x}.`)];
  s.fonti = fontiDi(s);
  s.completa = true;
  return s;
}

/** Le fonti in fondo alla scheda: tutte quelle citate, una volta sola. */
export function fontiDi(s: Scheda): { titolo: string; url: string }[] {
  const viste = new Map<string, string>();
  const metti = (url: string | null | undefined, titolo: string) => { if (apertaDalProgramma(url) && !viste.has(url)) viste.set(url, titolo); };
  for (const c of s.campi) metti(c.fonte, c.voce);
  for (const p of s.social) metti(p.fonte, p.canale);
  metti(s.sito.fonte, 'Sito');
  for (const c of s.concorrenti) metti(c.fonte, `${c.nome} (concorrente)`);
  return [...viste].map(([url, titolo]) => ({ titolo, url })).slice(0, 30);
}

export { CONDIZIONI, PAGAMENTO };
