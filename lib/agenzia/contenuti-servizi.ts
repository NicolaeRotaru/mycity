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

/* ───────────────────────────── SITO WEB: la bozza ───────────────────────────── */

export type SezioneSito = { titolo: string; testo: string };

export type BozzaSito = {
  /** Un indirizzo suggerito, da verificare se è libero: «panequotidiano.it». */
  indirizzo: string;
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

export function bozzaSito(nome: string, tipo: TipoAttivita): BozzaSito {
  const n = nome.trim() || 'La tua attività';
  return {
    indirizzo: indirizzoSuggerito(n),
    nome: n,
    sottotitolo: SOTTOTITOLO[tipo],
    invito: INVITO[tipo],
    sezioni: [
      { titolo: 'Chi siamo', testo: `La storia di ${n}, chi ci lavora e perché i clienti tornano. La scriviamo insieme a te.` },
      { titolo: 'Cosa offriamo', testo: 'I prodotti arrivano dalla tua vetrina MyCity e si aggiornano da soli: li cambi in un posto, cambiano anche qui.' },
      { titolo: 'Dove siamo e orari', testo: 'La mappa per arrivare, gli orari di apertura e i giorni di chiusura.' },
      { titolo: 'Contatti', testo: 'Telefono, WhatsApp e i tuoi social, a un tocco dal telefono del cliente.' },
    ],
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
function postNumero(i: number, nome: string, tipo: TipoAttivita, mese: number): Omit<PostDelPiano, 'data'> {
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
  return rotazione[i % rotazione.length];
}

/** Il piano del mese del preventivo: 3 post a settimana dal primo del mese, fino a 12 post. */
export function pianoEditoriale(nome: string, tipo: TipoAttivita, giorno: string): PianoEditoriale {
  const [anno, mese] = giorno.split('-').map(Number);
  const m = (Number.isInteger(mese) && mese >= 1 && mese <= 12 ? mese : 1) - 1;
  const a = Number.isInteger(anno) ? anno : 2026;
  const n = nome.trim() || 'noi';
  const giorniNelMese = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const post: PostDelPiano[] = [];
  for (let g = 1; g <= giorniNelMese && post.length < POST_NEL_PIANO; g++) {
    const data = new Date(Date.UTC(a, m, g));
    if (!GIORNI_DI_PUBBLICAZIONE.includes(data.getUTCDay())) continue;
    post.push({ data: data.toISOString().slice(0, 10), ...postNumero(post.length, n, tipo, m) });
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

/* ───────────────────── SCHEDA GOOGLE: come apparirà su Maps ───────────────────── */

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
