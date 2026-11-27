/**
 * COSA RICEVI, GIÀ PRONTO DENTRO IL PREVENTIVO — 23/11/2026.
 *
 * Nicola: «inserisci già quel servizio disponibile: dentro il sito una bozza del sito,
 * dentro social manager il piano editoriale del mese (con già degli esempi, però verranno
 * creati da n8n più avanti), dentro foto/video making/editing i formati».
 *
 * Il cliente non legge solo «Sito web: 500 €»: vede la bozza del SUO sito, col suo nome;
 * il calendario dei post del mese, con esempi scritti per il suo tipo di attività; i
 * formati di foto e video che riceve. Tutto è calcolato qui, senza rete, dai dati che il
 * preventivo ha già (nome, tipo di attività, giorno): la pagina disegna, non decide.
 *
 * Onestà (regola d'oro): sono ESEMPI e BOZZE, e la pagina lo dice. Niente prezzi, sconti o
 * numeri inventati dentro i post; l'indirizzo del sito è un suggerimento da verificare; i
 * post veri li preparerà il flusso n8n quando Nicola lo collega.
 */

import type { TipoAttivita } from './tipi-attivita';
import { datoDi, prodottiTipici, senzaValuta, valoreConfermato, vociSenzaPrezzo, type SchedaCliente } from './scheda-cliente';

/*
 * 24/11/2026 — CON LA SCHEDA DI N8N, LA BOZZA E IL PIANO DIVENTANO QUELLI DI QUEL LOCALE.
 *
 * Quando n8n ha mandato la scheda del cliente (lib/agenzia/scheda-cliente.ts), la bozza del sito
 * usa l'indirizzo, gli orari, il telefono, il sito e i prodotti tipici veri, e il piano dei post
 * parla dei suoi prodotti e delle idee trovate per lui. Dove un dato manca resta il testo generico
 * di prima. Solo frasi vere: un dato non ancora confermato dal titolare si segna «da confermare».
 * Orari e contatti nei post solo se confermati: un post li direbbe in pubblico.
 */

/* ───────────────────────────── SITO WEB: la bozza ───────────────────────────── */

export type SezioneSito = {
  titolo: string;
  testo: string;
  /** Vero se il testo usa un dato della scheda che il titolare non ha ancora confermato. */
  daConfermare?: boolean;
  /** Vero se il testo viene dalla scheda del locale, non dal modello generico. */
  dalLocale?: boolean;
};

export type BozzaSito = {
  /** Un indirizzo suggerito, da verificare se è libero: «panequotidiano.it». */
  indirizzo: string;
  /** Vero se l'indirizzo è quello del sito che il locale ha già (dalla scheda di n8n). */
  indirizzoEsistente?: boolean;
  nome: string;
  sottotitolo: string;
  /** Il pulsante principale della pagina: porta alla vetrina MyCity. */
  invito: string;
  sezioni: SezioneSito[];
};

const SOTTOTITOLO: Record<TipoAttivita, string> = {
  negozio: 'La tua bottega di fiducia a Piacenza, ora anche online.',
  bar: 'Colazioni, pause e aperitivi nel cuore di Piacenza.',
  ristorante: 'La nostra cucina a Piacenza: al tavolo o a casa tua.',
  artigiano: 'Fatto a mano a Piacenza, pezzo per pezzo.',
  servizi: 'Il tuo appuntamento di fiducia a Piacenza.',
  altro: 'A Piacenza, vicino a te.',
};

const INVITO: Record<TipoAttivita, string> = {
  negozio: 'Ordina dalla vetrina',
  bar: 'Guarda cosa offriamo',
  ristorante: 'Ordina da asporto',
  artigiano: 'Scopri i nostri lavori',
  servizi: 'Prenota o scrivici',
  altro: 'Scopri di più',
};

/** «Pane Quotidiano» → «panequotidiano.it». Solo lettere e cifre, senza accenti. */
export function indirizzoSuggerito(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return `${base || 'latuaattivita'}.it`;
}

const elencoUmano = (voci: string[]) =>
  voci.length <= 1 ? voci.join('') : `${voci.slice(0, -1).join(', ')} e ${voci[voci.length - 1]}`;

/** Il nome del sito senza «https://» e «www.»: «oradelgusto.it». `null` se non è un indirizzo. */
function dominioDi(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function bozzaSito(nome: string, tipo: TipoAttivita, scheda?: SchedaCliente | null): BozzaSito {
  const n = nome.trim() || 'La tua attività';
  // «È l'indirizzo del sito che hai già» è una frase che afferma: solo col sito confermato.
  const dominio = dominioDi(valoreConfermato(scheda, 'sito_ufficiale'));
  const prodotti = prodottiTipici(scheda, 5);
  const menu = datoDi(scheda, 'menu_testo');
  const indirizzo = datoDi(scheda, 'indirizzo');
  // Gli orari hanno cifre per forza: si scartano solo se nominano una moneta («aperitivo 5€»).
  const orariGrezzi = datoDi(scheda, 'orari');
  const orari = orariGrezzi && senzaValuta(orariGrezzi.valore) ? orariGrezzi : null;
  const telefono = datoDi(scheda, 'telefono');
  const prenota = datoDi(scheda, 'link_prenotazione');
  const punti = vociSenzaPrezzo(scheda?.analisi?.punti_di_forza, 3);

  const chiSiamo: SezioneSito = punti.length
    ? { titolo: 'Chi siamo', testo: `La storia di ${n}, scritta con te. Da dove partire, da quello che abbiamo trovato: ${elencoUmano(punti)}.`, daConfermare: true, dalLocale: true }
    : { titolo: 'Chi siamo', testo: `La storia di ${n}, chi ci lavora e perché i clienti tornano. La scriviamo insieme a te.` };
  const cosaOffriamo: SezioneSito = prodotti.length
    ? { titolo: 'Cosa offriamo', testo: `Da ${n} trovi ${elencoUmano(prodotti)}. I prodotti arrivano dalla tua vetrina MyCity e si aggiornano da soli.`, daConfermare: !menu?.confermato, dalLocale: true }
    : { titolo: 'Cosa offriamo', testo: 'I prodotti arrivano dalla tua vetrina MyCity e si aggiornano da soli: li cambi in un posto, cambiano anche qui.' };
  const doveSiamo: SezioneSito = indirizzo || orari
    ? {
        titolo: 'Dove siamo e orari',
        testo: [indirizzo ? `Ci trovi in ${indirizzo.valore}.` : 'La mappa per arrivare.', orari ? `Orari: ${orari.valore}.` : 'Gli orari di apertura e i giorni di chiusura.'].join(' '),
        daConfermare: Boolean((indirizzo && !indirizzo.confermato) || (orari && !orari.confermato)),
        dalLocale: true,
      }
    : { titolo: 'Dove siamo e orari', testo: 'La mappa per arrivare, gli orari di apertura e i giorni di chiusura.' };
  const contatti: SezioneSito = telefono || prenota
    ? {
        titolo: 'Contatti',
        testo: [telefono ? `Telefono ${telefono.valore}.` : null, prenota ? 'Il pulsante per prenotare, col tuo sistema di oggi.' : null, 'WhatsApp e i tuoi social, a un tocco.'].filter(Boolean).join(' '),
        daConfermare: Boolean((telefono && !telefono.confermato) || (prenota && !prenota.confermato)),
        dalLocale: true,
      }
    : { titolo: 'Contatti', testo: 'Telefono, WhatsApp e i tuoi social, a un tocco dal telefono del cliente.' };

  return {
    indirizzo: dominio ?? indirizzoSuggerito(n),
    indirizzoEsistente: Boolean(dominio),
    nome: n,
    sottotitolo: SOTTOTITOLO[tipo],
    invito: prenota && tipo !== 'negozio' ? 'Prenota' : INVITO[tipo],
    sezioni: [chiSiamo, cosaOffriamo, doveSiamo, contatti],
  };
}

/* ─────────────────────── SOCIAL: il piano editoriale del mese ─────────────────────── */

export type FormatoPost = 'Post foto' | 'Carosello' | 'Reel' | 'Storia';

export type PostDelPiano = {
  /** AAAA-MM-GG. */
  data: string;
  formato: FormatoPost;
  tema: string;
  /** Un esempio di testo: quello vero lo scrive il flusso automatico. */
  esempio: string;
  /** Vero se il post nasce dai dati del locale (prodotti, idee, orari della scheda). */
  dalLocale?: boolean;
};

export type PianoEditoriale = {
  /** «dicembre 2026». */
  mese: string;
  post: PostDelPiano[];
};

/** I giorni di pubblicazione: martedì, giovedì e sabato (3 post a settimana). */
const GIORNI_DI_PUBBLICAZIONE = [2, 4, 6];

/** Il prodotto o il servizio tipico, per scrivere esempi che suonano veri per quel tipo. */
const COSA: Record<TipoAttivita, { prodotto: string; luogo: string; gesto: string }> = {
  negozio: { prodotto: 'il prodotto della settimana', luogo: 'in bottega', gesto: 'sistemiamo gli scaffali' },
  bar: { prodotto: 'la colazione del giorno', luogo: 'al bancone', gesto: 'prepariamo il primo caffè' },
  ristorante: { prodotto: 'il piatto della settimana', luogo: 'in cucina', gesto: 'impastiamo e cuciniamo' },
  artigiano: { prodotto: 'il pezzo appena finito', luogo: 'in laboratorio', gesto: 'lavoriamo a mano' },
  servizi: { prodotto: 'il trattamento del mese', luogo: 'nel nostro studio', gesto: 'prepariamo tutto per te' },
  altro: { prodotto: 'la novità della settimana', luogo: 'da noi', gesto: 'ci prepariamo ad aprire' },
};

/** Un tema per mese, legato al calendario di Piacenza e alle stagioni. */
const TEMA_DEL_MESE = [
  'i buoni propositi di gennaio', 'San Valentino', 'l’arrivo della primavera', 'Pasqua',
  'la bella stagione', 'l’estate in città', 'le vacanze', 'chi resta in città ad agosto',
  'il rientro a settembre', 'l’autunno', 'l’atmosfera prima di Natale', 'Natale e i regali',
];

const NOMI_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/**
 * Quanti post mostra il piano: 12, come il Business («12 post al mese, 3 a settimana»). Fino al
 * 24/11 i post erano 6 ripetuti due volte (il 3 uguale al 17, il 5 al 19…): si notava, e faceva
 * sembrare tutto automatico proprio dove il preventivo promette «su misura per te».
 */
export const POST_NEL_PIANO = 12;

/** I 12 contenuti del mese, tutti diversi: prodotto, persone, vetrina, clienti e stagione. */
function postNumero(i: number, nome: string, tipo: TipoAttivita, mese: number, scheda?: SchedaCliente | null): Omit<PostDelPiano, 'data'> {
  const c = COSA[tipo];
  const stagione = TEMA_DEL_MESE[mese];
  const Stagione = `${stagione.charAt(0).toUpperCase()}${stagione.slice(1)}`;
  const rotazione: Omit<PostDelPiano, 'data'>[] = [
    { formato: 'Post foto', tema: 'Il prodotto in primo piano', esempio: `Oggi vi presentiamo ${c.prodotto}. Lo trovate ${c.luogo} e sulla nostra vetrina MyCity.` },
    { formato: 'Reel', tema: 'Dietro le quinte', esempio: `Ore 7: ${c.gesto}. Ecco come nasce una giornata da ${nome}.` },
    { formato: 'Carosello', tema: 'Ordina da casa', esempio: `Non riesci a passare? Ordina dalla vetrina MyCity di ${nome}: te lo portiamo noi a Piacenza.` },
    { formato: 'Storia', tema: 'La domanda ai clienti', esempio: `Qual è il vostro preferito da ${nome}? Rispondete al sondaggio!` },
    { formato: 'Post foto', tema: 'Chi siamo', esempio: `Dietro ${nome} ci sono persone vere: vi raccontiamo chi siamo e perché facciamo questo lavoro.` },
    { formato: 'Reel', tema: `Il tema del mese: ${stagione}`, esempio: `${Stagione}: ecco cosa abbiamo preparato ${c.luogo}.` },
    { formato: 'Carosello', tema: 'I più scelti della settimana', esempio: `I tre più scelti questa settimana da ${nome}: scorri e dicci qual è il tuo.` },
    { formato: 'Post foto', tema: 'Le mani al lavoro', esempio: `Ogni mattina ${c.gesto}: le mani di ${nome} al lavoro, da vicino.` },
    { formato: 'Storia', tema: 'Le novità', esempio: `Cosa c’è di nuovo ${c.luogo} questa settimana? Ve lo mostriamo qui, prima di tutti.` },
    { formato: 'Reel', tema: 'Una giornata in 30 secondi', esempio: `Dall’apertura alla chiusura: una giornata da ${nome} in 30 secondi.` },
    { formato: 'Post foto', tema: 'La domanda che ci fate più spesso', esempio: `La domanda che ci fate più spesso ${c.luogo}, e la nostra risposta.` },
    { formato: 'Carosello', tema: 'Il tema del mese, a domicilio', esempio: `${Stagione}: ordina dalla vetrina MyCity di ${nome} e te lo portiamo noi.` },
  ];
  const base = rotazione[i % rotazione.length];
  return conIDatiDelLocale(i, base, nome, c.luogo, scheda) ?? base;
}

/**
 * Il post col dato vero del locale, se la scheda ce l'ha: i prodotti tipici nei post sul prodotto
 * (1°, 8° e 12°, solo da un menu confermato), le idee trovate da n8n (senza prezzi) al posto di tre temi generici (5°, 9° e 11°), gli orari
 * confermati nella storia delle novità. Senza il dato, `null`: resta il post generico.
 */
function conIDatiDelLocale(
  i: number,
  base: Omit<PostDelPiano, 'data'>,
  nome: string,
  luogo: string,
  scheda?: SchedaCliente | null,
): Omit<PostDelPiano, 'data'> | null {
  if (!scheda) return null;
  // Un post esce in pubblico: i prodotti solo da un menu confermato, le idee senza prezzi.
  const prodotti = prodottiTipici(scheda, 8, true);
  const idee = vociSenzaPrezzo(scheda.analisi?.idee_contenuti, 3);
  const orariConfermati = valoreConfermato(scheda, 'orari');
  const orari = orariConfermati && senzaValuta(orariConfermati) ? orariConfermati : null;
  const prodotto = (k: number) => prodotti[k % prodotti.length];
  if (prodotti.length && i === 0) return { ...base, tema: `Il prodotto in primo piano: ${prodotto(0)}`, esempio: `Oggi vi presentiamo ${prodotto(0)}. Lo trovate ${luogo} e sulla nostra vetrina MyCity.`, dalLocale: true };
  if (prodotti.length && i === 7) return { ...base, tema: `Le mani al lavoro: ${prodotto(1)}`, esempio: `Come nasce ${prodotto(1)} da ${nome}: le mani al lavoro, da vicino.`, dalLocale: true };
  if (prodotti.length && i === 11) return { ...base, tema: `${prodotto(2)}, a domicilio`, esempio: `Voglia di ${prodotto(2)}? Ordina dalla vetrina MyCity di ${nome} e te lo portiamo noi.`, dalLocale: true };
  const posto = [4, 8, 10].indexOf(i);
  if (posto >= 0 && idee[posto]) return { ...base, tema: idee[posto].slice(0, 80), esempio: `${idee[posto]} — da ${nome}.`, dalLocale: true };
  if (i === 8 && orari) return { ...base, tema: 'Siamo aperti', esempio: `Vi aspettiamo ${luogo}: ${orari}.`, dalLocale: true };
  return null;
}

/**
 * 27/11/2026 — Il contenuto numero `i` (da 0 a 11) della stessa rotazione, cucito sul locale se c'è la scheda.
 * Lo usa il piano del primo mese dell'ordine di SDG (lib/agenzia/piano-del-primo-mese.ts), che ha le sue date
 * e le quantità della fascia: così il preventivo e l'ordine parlano con gli stessi esempi.
 */
export function contenutoDellaRotazione(i: number, nome: string, tipo: TipoAttivita, mese: number, scheda?: SchedaCliente | null): Omit<PostDelPiano, 'data'> {
  return postNumero(i, nome.trim() || 'noi', tipo, Number.isInteger(mese) && mese >= 0 && mese <= 11 ? mese : 0, scheda);
}

/** Il piano del mese del preventivo: 3 post a settimana dal primo del mese, fino a 12 post. */
export function pianoEditoriale(nome: string, tipo: TipoAttivita, giorno: string, scheda?: SchedaCliente | null): PianoEditoriale {
  const [anno, mese] = giorno.split('-').map(Number);
  const m = (Number.isInteger(mese) && mese >= 1 && mese <= 12 ? mese : 1) - 1;
  const a = Number.isInteger(anno) ? anno : 2026;
  const n = nome.trim() || 'noi';
  const giorniNelMese = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const post: PostDelPiano[] = [];
  for (let g = 1; g <= giorniNelMese && post.length < POST_NEL_PIANO; g++) {
    const data = new Date(Date.UTC(a, m, g));
    if (!GIORNI_DI_PUBBLICAZIONE.includes(data.getUTCDay())) continue;
    post.push({ data: data.toISOString().slice(0, 10), ...postNumero(post.length, n, tipo, m, scheda) });
  }
  return { mese: `${NOMI_MESI[m]} ${a}`, post };
}

/* ─────────────────── FOTO E VIDEO: i formati (making + editing) ─────────────────── */

export type FormatoMedia = { nome: string; misura: string; dove: string; cosa: string };

export const FORMATI_FOTO: FormatoMedia[] = [
  { nome: 'Foto della copertina', misura: 'orizzontale 16:9', dove: 'Vetrina MyCity, sito web', cosa: 'Il locale, l’ingresso e il bancone: le foto che scorrono in cima alla vetrina.' },
  { nome: 'Foto dei prodotti', misura: 'quadrata 1:1', dove: 'Catalogo MyCity, Instagram', cosa: 'Ogni prodotto su sfondo pulito, con la luce giusta: si vede quello che compri.' },
  { nome: 'Carosello', misura: 'verticale 4:5', dove: 'Instagram, Facebook', cosa: 'Più foto in un post: un prodotto da più lati, o i passaggi di una lavorazione.' },
  { nome: 'Ritratti', misura: 'verticale 4:5', dove: 'Sito web, social', cosa: 'Tu e chi lavora con te: le persone fanno tornare i clienti.' },
];

export const FORMATI_VIDEO: FormatoMedia[] = [
  { nome: 'Reel', misura: 'verticale 9:16, 15–30 secondi', dove: 'Instagram, TikTok, Facebook', cosa: 'Video brevi con musica e testo: il formato che oggi si vede di più.' },
  { nome: 'Storie', misura: 'verticale 9:16, 5–15 secondi', dove: 'Instagram, Facebook, WhatsApp', cosa: 'La novità del giorno, il dietro le quinte, il «siamo aperti».' },
  { nome: 'Video di presentazione', misura: 'orizzontale 16:9, 60–90 secondi', dove: 'Sito web, vetrina MyCity, YouTube', cosa: 'Chi sei, cosa fai e dove trovarti, in un minuto e mezzo.' },
];

export const LAVORI_DI_EDITING: string[] = [
  'Ritocco di luce e colore, uguale su tutte le foto',
  'Scontorno dei prodotti su sfondo pulito',
  'Montaggio con musica libera da diritti',
  'Sottotitoli: il video si capisce anche senza audio',
  'Il tuo nome o logo in sovrimpressione',
  'Una versione per ogni social, già nella misura giusta',
];

/* ──────────── SCHEDA GOOGLE: come apparirà su Maps (dentro la gestione social) ────────────
 * 24/11/2026 — Nicola: «gestione di social dentro è compreso anche Google Maps». La scheda non è
 * più un servizio a sé: la pagina della gestione social mostra il piano dei post e, sotto, questa.
 */

export type SchedaGoogle = {
  nome: string;
  /** La categoria che Google mostra sotto il nome. */
  categoria: string;
  /** Cosa sistemiamo, una riga per lavoro. */
  lavori: string[];
};

const CATEGORIA_GOOGLE: Record<TipoAttivita, string> = {
  negozio: 'Negozio',
  bar: 'Bar',
  ristorante: 'Ristorante',
  artigiano: 'Laboratorio artigianale',
  servizi: 'Servizi alla persona',
  altro: 'Attività locale',
};

export function schedaGoogle(nome: string, tipo: TipoAttivita): SchedaGoogle {
  return {
    nome: nome.trim() || 'La tua attività',
    categoria: `${CATEGORIA_GOOGLE[tipo]} · Piacenza`,
    lavori: [
      'Creiamo la scheda, o ti aiutiamo a recuperarla se esiste già',
      'Categoria giusta, così compari quando cercano quello che vendi',
      'Orari, giorni di chiusura e indirizzo corretti',
      'Le foto migliori del locale e dei prodotti',
      'Il collegamento alla tua vetrina MyCity e a WhatsApp',
    ],
  };
}
