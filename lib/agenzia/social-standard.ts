import { FASCE } from '@/lib/agenti/fasce';
import { FASCE as LISTINO, type Abbonamento } from './preventivo';
import type { TipoAttivita } from './tipi-attivita';
import type { ContenutoDelPiano, PianoDelMese } from './piano-del-primo-mese';
import type { Social } from './lavoro-consegnato/tipi';
import type { AnalisiAvvioOrdine } from './analisi-dell-ordine-ad';
import { daDovePartiamoSuiSocial } from './analisi-standard';

/**
 * LO STANDARD DELLA GESTIONE SOCIAL — 28/11/2026.
 *
 * Nicola, 28/11: «Guarda il modo in cui è stato creato la gestione dei social dentro SDG. È stato fatto veramente
 * molto bene e vorrei che venisse usato come base, come standard. Poi va personalizzato in base al cliente, in base
 * ai dati che abbiamo sul cliente, e in base all'abbonamento».
 *
 * La base è il piano Premium che SDG ha fatto per se stessa (lib/agenzia/lavoro-consegnato/sdg/social.json, disegnato
 * da components/seller/lavoro-consegnato/PianoEditorialeConsegnato.tsx): obiettivo, a chi parliamo, i canali col loro
 * ruolo, i pilastri con la loro parte, quanto esce nel mese, il calendario a settimane, cosa comprende l'abbonamento
 * oltre il calendario, come misuriamo e le regole. Qui ogni cliente prende la stessa forma, riempita:
 *  · DAL CLIENTE: nome, tipo di attività, città, i profili che l'analisi ha trovato, la frase su misura che l'AD ha
 *    scritto per il suo abbonamento, e i contenuti del suo piano (quello del sito o quello completo dell'AD);
 *  · DALL'ABBONAMENTO: le quantità e cosa comprende la scheda Google vengono dal listino (lib/agenzia/preventivo.ts),
 *    mai scritte qui; lo «strato» di ogni contenuto dice da quale abbonamento arriva (Base, Business o Premium).
 *
 * Quello che il SDG di dicembre aveva solo per sé non si copia: pubblicità, creator, giornali, eventi, LinkedIn e la
 * lista WhatsApp non sono nel listino, e niente festivi senza post (un bar a Santo Stefano è aperto). Nessun numero
 * inventato negli obiettivi: il punto di partenza si legge all'avvio.
 */

/** I cinque pilastri, uguali per ogni attività: cambia solo la descrizione, secondo il tipo. */
export const PILASTRI = ['Quello che offriamo', 'Dietro le quinte', 'Clienti e quartiere', 'La vetrina MyCity', 'Il mese in città'] as const;
export type Pilastro = (typeof PILASTRI)[number];

const COSA: Record<TipoAttivita, { offerta: string; dove: string }> = {
  negozio: { offerta: 'i prodotti, le novità e i più scelti', dove: 'in bottega' },
  bar: { offerta: 'la colazione, il bancone, le novità del giorno', dove: 'al bancone' },
  ristorante: { offerta: 'i piatti, il menu della settimana, la cucina di stagione', dove: 'in cucina' },
  artigiano: { offerta: 'i pezzi finiti, i materiali, le ordinazioni', dove: 'in laboratorio' },
  servizi: { offerta: 'i trattamenti e i servizi, spiegati in modo semplice', dove: 'nello studio' },
  altro: { offerta: 'quello che facciamo, con le novità', dove: 'da noi' },
};

export function pilastriPerIlTipo(tipo: TipoAttivita): { nome: Pilastro; descrizione: string }[] {
  const c = COSA[tipo] ?? COSA.altro;
  const vetrina = tipo === 'servizi' ? 'Come trovarci e prenotare dalla vetrina MyCity.' : 'Come ordinare dalla vetrina MyCity e riceverlo a casa, o ritirarlo.';
  return [
    { nome: 'Quello che offriamo', descrizione: `${c.offerta.charAt(0).toUpperCase()}${c.offerta.slice(1)}: le foto vere, senza prezzi non confermati.` },
    { nome: 'Dietro le quinte', descrizione: `Le persone e le mani al lavoro ${c.dove}: mettono un volto sull'attività.` },
    { nome: 'Clienti e quartiere', descrizione: 'Le domande che fanno i clienti, i sondaggi, il quartiere intorno: nessun nome di cliente senza il suo consenso.' },
    { nome: 'La vetrina MyCity', descrizione: vetrina },
    { nome: 'Il mese in città', descrizione: 'Il tema del mese e gli eventi veri della città, solo con una fonte.' },
  ];
}

/**
 * Il pilastro di un contenuto: quello scelto dall'AD se è uno dei cinque, altrimenti dal tema. L'ordine conta:
 * «Il tema del mese, a domicilio» è vetrina, «Un grazie a chi lavora con noi» è dietro le quinte.
 */
export function pilastroDelContenuto(c: Pick<ContenutoDelPiano, 'tema'> & { pilastro?: string | null; inCitta?: string | null }): Pilastro {
  if (c.pilastro && (PILASTRI as readonly string[]).includes(c.pilastro)) return c.pilastro as Pilastro;
  const t = (c.tema ?? '').toLowerCase();
  if (/ordin|domicilio|vetrina|mycity|a casa|consegn|ritir/.test(t)) return 'La vetrina MyCity';
  if (c.inCitta || /\bmese\b|natale|pasqua|festa|mercato|evento|stagion|estate|autunno|inverno|primavera|fiera|concerto|sagra|valentino|vacanz|rientro/.test(t)) return 'Il mese in città';
  if (/quinte|chi siamo|mani|giornata|prepar|nasce|squadra|lavor|laboratorio|cucina|passo per passo/.test(t)) return 'Dietro le quinte';
  if (/client|domand|sondaggio|quartiere|grazie|recension|parola/.test(t)) return 'Clienti e quartiere';
  return 'Quello che offriamo';
}

/** I dati del cliente che servono allo standard: solo quelli che il titolare può vedere. */
export type DatiPerLoStandard = {
  nome: string;
  fascia: Abbonamento;
  tipo?: TipoAttivita | null;
  citta?: string | null;
  /** I profili trovati dall'analisi (canale + pagina pubblica). `null` = l'analisi non c'è. */
  canaliTrovati?: { canale: string; fonte: string | null }[] | null;
  /** La frase che l'AD ha scritto per il servizio social di QUESTO cliente nella sua fascia (è nel suo preventivo). */
  suMisura?: string | null;
  /** 28/11/2026 — L'analisi del cliente all'avvio, quando è pronta: cosa ha visto sui suoi social e sui concorrenti. */
  analisi?: Pick<AnalisiAvvioOrdine, 'parti'> | null;
};

const OBIETTIVO: Record<TipoAttivita, (nome: string, citta: string) => string> = {
  negozio: (n) => `Far entrare da ${n} chi abita e lavora vicino, e portare ordini sulla vetrina MyCity.`,
  bar: (n, c) => `Far tornare chi passa già da ${n} e farsi scegliere da chi cerca un bar a ${c}, per la colazione, la pausa o l'aperitivo.`,
  ristorante: (n) => `Riempire i tavoli di ${n} anche nei giorni più vuoti: più prenotazioni e più chiamate dalla scheda Google.`,
  artigiano: (n) => `Far vedere il lavoro fatto a mano da ${n} e portare richieste e ordinazioni.`,
  servizi: (n) => `Portare a ${n} richieste di appuntamento e chiamate da chi cerca vicino.`,
  altro: (n) => `Far conoscere ${n} a chi cerca vicino, e portare contatti e visite.`,
};

const A_CHI: Record<TipoAttivita, (nome: string, citta: string) => string> = {
  negozio: (n, c) => `A chi abita e lavora vicino a ${n}, a ${c}: persone che comprano volentieri sotto casa, se sanno cosa trovano. Parliamo di prodotti veri, di chi li sceglie e di come averli anche a casa.`,
  bar: (_n, c) => `A chi passa ogni giorno in zona (chi lavora, chi studia, chi fa la spesa) e a chi cerca un posto per la colazione o l'aperitivo a ${c}. Parliamo del bancone, delle persone e dei momenti della giornata.`,
  ristorante: (_n, c) => `A chi cerca dove mangiare a ${c}, a pranzo o a cena, e a chi è già venuto e può tornare. Parliamo dei piatti, della cucina e di chi ci lavora.`,
  artigiano: (_n, c) => `A chi cerca un lavoro fatto a mano a ${c}, per sé o da regalare. Parliamo di come nasce ogni pezzo e di chi lo fa.`,
  servizi: (_n, c) => `A chi cerca vicino a sé, a ${c}, un servizio di cui fidarsi. Parliamo di come lavoriamo, delle domande più frequenti e di chi ci lavora.`,
  altro: (n, c) => `A chi abita e lavora vicino a ${n}, a ${c}. Parliamo di quello che facciamo e di chi lo fa.`,
};

/** La pagina pubblica di un profilo, scritta corta: «instagram.com/caffe_di_piacenza». */
function profiloCorto(fonte: string | null | undefined): string | null {
  if (!fonte || !/^https:\/\/[^\s"'<>]+$/.test(fonte)) return null;
  try {
    const u = new URL(fonte);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.slice(0, 80);
  } catch {
    return null;
  }
}

const CANALE_TROVATO: Record<'Instagram' | 'Facebook' | 'Scheda Google', RegExp> = {
  Instagram: /instagram/i,
  Facebook: /facebook/i,
  'Scheda Google': /google|maps/i,
};

/** Il canale si riconosce dal suo nome o dal dominio della pagina, mai dal resto dell'indirizzo («instagram.com/mapsbakery»). */
export function canaleE(nome: keyof typeof CANALE_TROVATO, c: { canale: string; fonte: string | null }): boolean {
  let dominio = '';
  try {
    dominio = c.fonte ? new URL(c.fonte).hostname : '';
  } catch {
    dominio = '';
  }
  return CANALE_TROVATO[nome].test(c.canale) || CANALE_TROVATO[nome].test(dominio);
}

function canaliDelPiano(d: DatiPerLoStandard, citta: string): Social['canali'] {
  const f = FASCE[d.fascia];
  const video = f.video > 0 ? `, con ${f.video === 1 ? 'un video breve' : `${f.video} video brevi`} al mese` : '';
  const storie = d.fascia === 'premium' ? ' e le storie' : '';
  const google: Record<Abbonamento, string> = {
    base: 'La creiamo o la sistemiamo all’avvio, per farti trovare da chi cerca vicino a te: la categoria giusta, gli orari, le foto e il collegamento alla vetrina MyCity.',
    business: 'La sistemiamo all’avvio, e le risposte alle recensioni le scriviamo noi.',
    // Collaudo 28/11: il listino Premium non dà una frequenza ai post su Google, e qui non se ne inventa una.
    premium: 'La curiamo ogni mese: foto nuove, i post e le risposte alle recensioni.',
  };
  const ruoli: Record<keyof typeof CANALE_TROVATO, string> = {
    Instagram: `La vetrina di tutti i giorni: post e caroselli con le foto vere${video}${storie}.`,
    Facebook: 'Gli stessi contenuti di Instagram, pubblicati insieme.',
    'Scheda Google': google[d.fascia],
  };
  return (Object.keys(CANALE_TROVATO) as (keyof typeof CANALE_TROVATO)[]).map((nome) => {
    const trovato = (d.canaliTrovati ?? []).find((c) => canaleE(nome, c));
    // Mai «da aprire»: l'analisi può non aver visto un profilo che c'è (il Raquel Cafè del 28/11). Si collega alla visita.
    return { nome, account: profiloCorto(trovato?.fonte) ?? (trovato ? 'trovato, da collegare alla visita' : 'da collegare alla visita'), ruolo: ruoli[nome], da_aprire: false };
  });
}

/** Le percentuali dei pilastri contate sul calendario vero, arrotondate perché la somma faccia 100. */
function percentuali(conti: Map<Pilastro, number>, totale: number): Map<Pilastro, number> {
  const voci = PILASTRI.filter((p) => (conti.get(p) ?? 0) > 0).map((p) => {
    const esatto = ((conti.get(p) ?? 0) * 100) / totale;
    return { p, intero: Math.floor(esatto), resto: esatto - Math.floor(esatto) };
  });
  let mancano = 100 - voci.reduce((s, v) => s + v.intero, 0);
  for (const v of [...voci].sort((a, b) => b.resto - a.resto)) {
    if (mancano <= 0) break;
    v.intero += 1;
    mancano -= 1;
  }
  return new Map(voci.map((v) => [v.p, v.intero]));
}

/** Un giorno vero, non solo nella forma: «2026-11-99» e «2026-11-31» no (collaudo 28/11: facevano crollare la pagina). */
export const giornoValido = (g: unknown): g is string => {
  if (typeof g !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(g)) return false;
  const d = new Date(`${g}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === g;
};
const oraValida = (o: unknown): o is string => typeof o === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o);
const testoOVuoto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const TIPI = ['Post', 'Carosello', 'Reel', 'Storia'];

/**
 * Il piano di un cliente nella forma standard (quella di SDG), personalizzato coi suoi dati e col suo abbonamento.
 * Regge un piano a metà (un ordine vecchio, un piano senza periodo): esce un piano coi pezzi che ci sono.
 */
export function socialDalPiano(piano: PianoDelMese | null | undefined, d: DatiPerLoStandard): Social {
  const fascia: Abbonamento = d.fascia in FASCE ? d.fascia : 'base';
  const f = FASCE[fascia];
  const tipo: TipoAttivita = d.tipo && d.tipo in COSA ? d.tipo : 'altro';
  const nome = (d.nome ?? '').trim() || 'la tua attività';
  const citta = (d.citta ?? '').trim() || 'Piacenza';

  const grezzi = Array.isArray(piano?.contenuti) ? piano!.contenuti : [];
  const contenuti = grezzi
    // Un contenuto senza tipo, o una storia fuori dal Premium (il listino le dà solo lì), non si mostra.
    .filter((c) => c && giornoValido(c.data) && oraValida(c.ora) && typeof c.tema === 'string' && TIPI.includes(c.tipo) && (c.tipo !== 'Storia' || fascia === 'premium'))
    .sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));

  // Lo strato: da quale abbonamento arriva ogni contenuto. Il Base dà 8 post senza video; il Business ne aggiunge 4,
  // di cui 2 video; il Premium aggiunge il resto, i video in più e le storie (quote dal listino, lib/agenti/fasce.ts).
  const quotaBase = FASCE.base.post;
  const quotaBusinessFoto = FASCE.business.post - FASCE.base.post - FASCE.business.video;
  let foto = 0;
  let video = 0;
  const strato = (c: ContenutoDelPiano): Social['calendario'][number]['strato'] => {
    if (fascia === 'base') return 'base';
    if (c.tipo === 'Storia') return 'premium';
    if (c.tipo === 'Reel') return video++ < FASCE.business.video ? 'business' : fascia === 'premium' ? 'premium' : 'business';
    const n = foto++;
    if (n < quotaBase) return 'base';
    if (n < quotaBase + quotaBusinessFoto) return 'business';
    return fascia === 'premium' ? 'premium' : 'business';
  };

  const formato: Record<string, string> = { Post: 'Post foto', Carosello: 'Carosello', Reel: 'Reel', Storia: 'Storia' };
  const calendario: Social['calendario'] = contenuti.map((c) => {
    const evento = c.inCitta && c.fonteEvento && /^https:\/\//.test(c.fonteEvento) ? { in_citta: c.inCitta, fonte_evento: c.fonteEvento } : {};
    return {
      giorno: c.data,
      ora: c.ora,
      canale: 'Instagram + Facebook',
      formato: formato[c.tipo],
      pilastro: pilastroDelContenuto(c),
      titolo: c.tema,
      testo: testoOVuoto(c.didascalia),
      strato: strato(c),
      stato: 'da_approvare',
      ...evento,
    };
  });

  const conti = new Map<Pilastro, number>();
  for (const c of calendario) conti.set(c.pilastro as Pilastro, (conti.get(c.pilastro as Pilastro) ?? 0) + 1);
  const parti = percentuali(conti, Math.max(calendario.length, 1));
  const pilastri = pilastriPerIlTipo(tipo)
    .filter((p) => parti.has(p.nome))
    .map((p) => ({ nome: p.nome, percentuale: parti.get(p.nome) ?? 0, descrizione: p.descrizione }));

  const feed = calendario.filter((c) => c.formato !== 'Storia');
  const reel = feed.filter((c) => c.formato === 'Reel').length;
  const storie = calendario.length - feed.length;
  const quantita: Social['quantita'] = [
    { voce: 'Contenuti nel mese (post, caroselli e video)', quanti: feed.length },
    ...(reel > 0 ? [{ voce: 'di cui video brevi (reel)', quanti: reel }] : []),
    ...(storie > 0 ? [{ voce: 'Storie', quanti: storie }] : []),
  ];

  const suMisura = (d.suMisura ?? '').trim();
  const intestazione = piano?.intestazione;
  const hashtag = testoOVuoto(intestazione?.hashtag);
  const primaDiPubblicare = testoOVuoto(intestazione?.primaDiPubblicare);
  const intrattenimento = tipo === 'bar' || tipo === 'ristorante';

  return {
    titolo: `Piano editoriale ${f.nome} di ${nome}${testoOVuoto(piano?.periodo?.titolo) ? `, ${testoOVuoto(piano?.periodo?.titolo)}` : ''}`,
    fascia,
    mese: giornoValido(piano?.periodo?.dal) ? piano!.periodo.dal.slice(0, 7) : '',
    aggiornato_il: '',
    obiettivo: `${OBIETTIVO[tipo](nome, citta)} Sono obiettivi, non promesse.${suMisura ? ` Su misura per te: ${suMisura}` : ''}`,
    a_chi_parliamo: A_CHI[tipo](nome, citta),
    tono: testoOVuoto(intestazione?.canaliETono) || null,
    canali: canaliDelPiano({ ...d, fascia }, citta),
    pilastri,
    quantita,
    calendario,
    titolo_extra: `Compreso nel ${f.nome}, oltre il calendario`,
    da_dove_partiamo: daDovePartiamoSuiSocial(d.analisi),
    extra_premium: [
      { voce: `Il ${f.nome}`, cosa: LISTINO[fascia].servizi.social, costo_fuori_canone: null },
      ...(fascia !== 'base' ? [{ voce: 'Le risposte alle recensioni', cosa: 'Le scriviamo noi, con il tono della tua attività: niente recensioni comprate o scambiate con sconti.', costo_fuori_canone: null }] : []),
      ...(fascia === 'premium' && storie === 0 ? [{ voce: 'Le storie', cosa: 'Quando c’è qualcosa da far vedere: non sono nel calendario, le decidiamo con te.', costo_fuori_canone: null }] : []),
    ],
    misure: [
      { kpi: 'Persone raggiunte su Instagram e Facebook', obiettivo: 'Più del mese prima: il punto di partenza lo leggiamo all’avvio', come_si_misura: 'Le statistiche di Instagram e Facebook, lette a fine mese' },
      { kpi: 'Chiamate e indicazioni stradali dalla scheda Google', obiettivo: 'Più del mese prima', come_si_misura: 'Il rendimento della scheda Google, letto a fine mese' },
      { kpi: 'Messaggi ricevuti sui social', obiettivo: 'Più del mese prima', come_si_misura: 'I messaggi diretti, contati a fine mese' },
      { kpi: 'Ordini e richieste dalla vetrina MyCity', obiettivo: 'Più del mese prima', come_si_misura: 'Gli ordini nel tuo pannello MyCity' },
      ...(f.video > 0 ? [{ kpi: 'Quanto guardano i video', obiettivo: 'Più del mese prima', come_si_misura: 'Le visualizzazioni dei reel, nelle statistiche di Instagram' }] : []),
      ...(fascia !== 'base' ? [{ kpi: 'Recensioni con una risposta', obiettivo: 'Le recensioni nuove con una risposta scritta da noi', come_si_misura: 'La scheda Google' }] : []),
    ],
    regole: [
      'Ogni contenuto lo vedi prima che esca: si pubblica solo col tuo sì.',
      ...(primaDiPubblicare ? [`Prima di pubblicare: ${primaDiPubblicare}`] : []),
      'Prezzi, orari e prodotti solo se li confermi tu: mai inventati.',
      'Persone riconoscibili in foto e video solo con il loro consenso scritto.',
      `Nessun risultato non provato, nessun «il migliore di ${citta}».`,
      'Foto e video veri della tua attività: niente foto d’archivio al posto delle persone.',
      ...(f.video > 0 ? ['La musica dei video solo con licenza per uso commerciale.'] : []),
      'Feste e chiusure: si pubblica solo se sei aperto, e lo confermiamo con te.',
      ...(intrattenimento ? ['Niente gioco né tabacco; l’alcol si racconta in modo responsabile.'] : []),
      ...(hashtag ? [`Ogni didascalia chiude con gli hashtag fissi: ${hashtag}.`] : []),
      'Non si cancella niente: un contenuto che non va più si archivia.',
    ],
  };
}
