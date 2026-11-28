import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import type { TipoAttivita } from './tipi-attivita';
import type { SchedaCliente } from './scheda-cliente';
import { contenutoDellaRotazione } from './contenuti-servizi';

/**
 * IL PIANO EDITORIALE DEL PRIMO MESE, DENTRO L'ORDINE DI SDG — 27/11/2026.
 *
 * Nicola: nell'ordine deve esserci «tutto il piano editoriale già fatto, preparato, con tutte le cose, così come si
 * è fatto per dentro la sessione bar caffè di Piacenza». Il metro è il foglio del Caffè di Piacenza (dicembre 2026):
 * in testa cliente, abbonamento, canali e tono, hashtag fissi e cosa confermare prima di pubblicare; poi una riga per
 * contenuto con data, ora, tipo, tema, stato, didascalia proposta, cosa riprendere ed evento in città.
 *
 * Questo è il piano che il sito mette SUBITO nell'ordine, senza rete, così l'ordine non arriva mai vuoto:
 *  · quanti contenuti e quanti video sono quelli del listino del sito (lib/agenti/fasce.ts: Base 8 senza video,
 *    Business 12 con 2 video, Premium 20 con 4 video), non di più: è quello che il titolare ha comprato;
 *  · gli esempi sono quelli del preventivo (lib/agenzia/contenuti-servizi.ts), cuciti sul locale se c'è la scheda;
 *  · le date partono dal lunedì dopo la visita (o dopo la conferma, se la visita non è fissata) e coprono 4
 *    settimane: niente post prima che SDG abbia fatto le foto;
 *  · gli eventi della città restano vuoti: li cerca l'AD, con le fonti vere, nel piano completo
 *    (lib/agenzia/piano-completo-ad.ts), che quando torna prende il posto di questo.
 */

export const TIPI_CONTENUTO = ['Post', 'Carosello', 'Reel', 'Storia'] as const;
export type TipoContenuto = (typeof TIPI_CONTENUTO)[number];

export type ContenutoDelPiano = {
  /** AAAA-MM-GG, ora di Roma. */
  data: string;
  /** HH:MM. */
  ora: string;
  tipo: TipoContenuto;
  tema: string;
  stato: 'Idea';
  didascalia: string;
  cosaRiprendere: string;
  /** L'evento in città quel giorno, con la sua fonte: solo nel piano dell'AD. */
  inCitta: string | null;
  fonteEvento?: string | null;
  /** 28/11/2026 — Il pilastro dello standard SDG scelto dall'AD (lib/agenzia/social-standard.ts); senza, si ricava dal tema. */
  pilastro?: string | null;
};

export type PianoDelMese = {
  /** 'sito' = la prima versione calcolata qui; 'ad' = il piano completo dell'AD. */
  origine: 'sito' | 'ad';
  periodo: { dal: string; al: string; titolo: string };
  intestazione: { cliente: string; abbonamento: string; canaliETono: string; hashtag: string; primaDiPubblicare: string };
  contenuti: ContenutoDelPiano[];
  note: string[];
};

/** I giorni della settimana in cui si pubblica (0 = domenica): 2, 3 o 5 a settimana, come il listino. */
export const GIORNI_PER_FASCIA: Record<Abbonamento, number[]> = {
  base: [2, 5],
  business: [2, 4, 6],
  premium: [2, 3, 4, 5, 6],
};

/** L'ora di pubblicazione per tipo di attività: quando i suoi clienti guardano il telefono. */
const ORA: Record<TipoAttivita, { feed: string; reel: string }> = {
  bar: { feed: '08:00', reel: '08:00' },
  ristorante: { feed: '18:30', reel: '19:00' },
  negozio: { feed: '10:00', reel: '10:00' },
  artigiano: { feed: '11:00', reel: '11:00' },
  servizi: { feed: '12:30', reel: '12:30' },
  altro: { feed: '10:00', reel: '10:00' },
};

const COSA_RIPRENDERE: Record<Exclude<TipoContenuto, 'Storia'>, string> = {
  Post: 'Una foto verticale 4:5 del soggetto, con luce naturale. Persone riconoscibili solo con il consenso scritto.',
  Carosello: 'Da 4 a 6 foto verticali 4:5 sullo stesso tema: la prima fa da copertina.',
  Reel: 'Video verticale 9:16 di 15-30 secondi, 4 o 5 riprese da 3-5 secondi. Musica solo con licenza per uso commerciale.',
};

/** I contenuti dal 13° al 20° (solo Premium): altri temi, perché i primi 12 non si ripetano. */
function contenutoInPiu(k: number, nome: string, citta: string): { formato: 'Post foto' | 'Carosello' | 'Reel'; tema: string; esempio: string } {
  const altri = [
    { formato: 'Post foto' as const, tema: 'La parola ai clienti', esempio: `Ce lo dite spesso, e ci fa piacere: grazie a chi passa da ${nome} e ce lo racconta.` },
    { formato: 'Reel' as const, tema: 'Come si prepara, passo per passo', esempio: `Dall'inizio alla fine, in pochi secondi: come nasce una delle cose che preferite da ${nome}.` },
    { formato: 'Carosello' as const, tema: 'Il quartiere intorno a noi', esempio: `${nome} è parte di ${citta}: scorri e scopri gli angoli che vediamo ogni giorno dalla porta.` },
    { formato: 'Post foto' as const, tema: 'Il dettaglio che non si nota', esempio: `C'è un dettaglio da ${nome} che in pochi notano. Lo avevi visto?` },
    { formato: 'Carosello' as const, tema: 'Le domande dei clienti', esempio: `Le tre domande che ci fate più spesso, con le nostre risposte. Scorri.` },
    { formato: 'Post foto' as const, tema: 'Prima e dopo l’apertura', esempio: `Alle sette è tutto spento, un'ora dopo è così: buongiorno da ${nome}.` },
    { formato: 'Carosello' as const, tema: 'Il riepilogo della settimana', esempio: `La nostra settimana in cinque foto. Quale vi è piaciuta di più?` },
    { formato: 'Post foto' as const, tema: 'Un grazie a chi lavora con noi', esempio: `Dietro ogni giornata da ${nome} ci sono persone vere: oggi diciamo grazie a loro.` },
  ];
  return altri[k % altri.length];
}

/** «Caffè di Piacenza» → «#CaffèDiPiacenza». */
export function hashtagDelNome(nome: string): string {
  const parole = nome.match(/[\p{L}\p{N}]+/gu) ?? [];
  const unito = parole.map((p) => p.charAt(0).toLocaleUpperCase('it-IT') + p.slice(1)).join('').slice(0, 40);
  return unito ? `#${unito}` : '';
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Il giorno (AAAA-MM-GG) di un istante, come si vede a Roma. */
export function giornoARoma(istante: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(istante).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

const comeData = (giorno: string) => new Date(`${giorno}T12:00:00Z`);
const piuGiorni = (giorno: string, n: number) => {
  const d = comeData(giorno);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const scriviGiorno = (giorno: string, conAnno: boolean) => {
  const d = comeData(giorno);
  return `${d.getUTCDate()} ${MESI[d.getUTCMonth()]}${conAnno ? ` ${d.getUTCFullYear()}` : ''}`;
};

/** Il lunedì dopo un giorno (mai lo stesso giorno: la visita serve a fare le foto). */
export function lunediDopo(giorno: string): string {
  const dow = comeData(giorno).getUTCDay();
  return piuGiorni(giorno, ((8 - dow) % 7) || 7);
}

export type DatiPerIlPiano = {
  nome: string;
  tipo: TipoAttivita;
  fascia: Abbonamento;
  indirizzo?: string | null;
  citta?: string | null;
  /** La visita del team creativo, se fissata (istante ISO). */
  visitaIl?: string | null;
  /** Quando il titolare ha confermato (istante ISO); se manca, adesso. */
  accettatoIl?: string | null;
  scheda?: SchedaCliente | null;
};

/** Il periodo del piano: 4 settimane dal lunedì dopo la visita, o dopo la conferma se la visita non c'è. */
export function periodoDelPiano(visitaIl?: string | null, accettatoIl?: string | null): { dal: string; al: string; titolo: string } {
  const visita = visitaIl && !Number.isNaN(Date.parse(visitaIl)) ? new Date(visitaIl) : null;
  const conferma = accettatoIl && !Number.isNaN(Date.parse(accettatoIl)) ? new Date(accettatoIl) : new Date();
  const dal = lunediDopo(giornoARoma(visita ?? conferma));
  const al = piuGiorni(dal, 27);
  const anniDiversi = dal.slice(0, 4) !== al.slice(0, 4);
  return { dal, al, titolo: `dal ${scriviGiorno(dal, anniDiversi)} al ${scriviGiorno(al, true)}` };
}

/** Il piano del primo mese, calcolato dal sito: le quantità della fascia, gli esempi del preventivo, le date vere. */
export function pianoDelPrimoMese(d: DatiPerIlPiano): PianoDelMese {
  const nome = d.nome.trim() || 'La tua attività';
  const citta = (d.citta ?? '').trim() || 'Piacenza';
  const fascia = FASCE[d.fascia];
  const quanti = fascia.post;
  const video = fascia.video;
  const periodo = periodoDelPiano(d.visitaIl, d.accettatoIl);
  const hashtag = [`#${(citta.match(/[\p{L}]+/gu) ?? ['Piacenza']).join('')}`, hashtagDelNome(nome)].filter(Boolean).join(' ');

  // I giorni di pubblicazione dentro le 4 settimane: esattamente quanti ne dà la fascia.
  const giorni: string[] = [];
  for (let k = 0; k < 28 && giorni.length < quanti; k++) {
    const g = piuGiorni(periodo.dal, k);
    if (GIORNI_PER_FASCIA[d.fascia].includes(comeData(g).getUTCDay())) giorni.push(g);
  }

  // Quali diventano video: prima quelli nati per il video (una giornata in 30 secondi, il dietro le quinte, il tema
  // del mese, il passo per passo), e solo quanti ne dà la fascia. Nel Base nessuno.
  const preferiti = [9, 1, 5, 13].filter((i) => i < quanti).slice(0, video);
  const mese = comeData(periodo.dal).getUTCMonth();

  const contenuti: ContenutoDelPiano[] = giorni.map((data, i) => {
    const base = i < 12
      ? contenutoDellaRotazione(i, nome, d.tipo, mese, d.scheda)
      : (() => { const x = contenutoInPiu(i - 12, nome, citta); return { formato: x.formato, tema: x.tema, esempio: x.esempio }; })();
    const tipo: Exclude<TipoContenuto, 'Storia'> = preferiti.includes(i) ? 'Reel' : base.formato === 'Carosello' ? 'Carosello' : 'Post';
    return {
      data,
      ora: tipo === 'Reel' ? ORA[d.tipo].reel : ORA[d.tipo].feed,
      tipo,
      tema: base.tema,
      stato: 'Idea',
      didascalia: `${base.esempio} ${hashtag}`.trim(),
      cosaRiprendere: COSA_RIPRENDERE[tipo],
      inCitta: null,
    };
  });

  const note = [
    'Prima versione, calcolata dal sito con gli esempi per il tipo di attività: il piano completo, coi fatti del locale e gli eventi della città, lo prepara l’AD.',
    d.visitaIl ? 'Le date partono dal lunedì dopo la visita: prima servono le foto.' : 'La visita non è ancora fissata: le date partono dal lunedì dopo la conferma e si spostano quando la si fissa.',
    ...(d.fascia === 'premium' ? ['Più le storie, giorno per giorno: non sono in questo elenco.'] : []),
  ];

  return {
    origine: 'sito',
    periodo,
    intestazione: {
      cliente: [nome, (d.indirizzo ?? '').trim()].filter(Boolean).join(', '),
      abbonamento: `${fascia.nome}: ${fascia.inPratica.piano}`,
      canaliETono: 'Instagram, Facebook e la scheda Google; tono cordiale e semplice, da confermare col titolare alla visita',
      hashtag,
      primaDiPubblicare: 'Confermare col titolare orari, telefono, prodotti e prezzi, e il consenso scritto di chi compare in foto e video. Niente esce senza il suo sì.',
    },
    contenuti,
    note,
  };
}
