import type { PaginaDellaBozza } from '@/lib/agenzia/sito-dell-ordine-ad';
import { disegnoPer, DISEGNI, type Disegno } from './disegni';

/**
 * COSA DICE IL SITO — il modello dei contenuti, 28/11/2026.
 *
 * Il sito si costruisce da qui: una frase d'apertura, i momenti della giornata, il locale, cosa offre, perché venire,
 * la zona, le novità e le domande. Dal 28/11 pomeriggio l'AD scrive direttamente questo (`contenuto` nella colonna
 * `sito`); per i siti scritti prima, coi soli testi a pagine, `contenutoDaPagine` li rimette in questa forma.
 *
 * Le tavolozze sono poche e scelte: il colore del marchio del negozio, quando l'ha scelto, prende il posto del colore
 * principale (skill «armonia», regola 4). Contrasto del testo controllato su ogni fondo (almeno 4,5:1).
 */

export const PALETTE = {
  crema: { fondo: '#FBF6EE', carta: '#FFFDF9', tenue: '#6B5E55', inchiostro: '#2B211B', marchio: '#9A4A2C', accento: '#E9D6BF', scuro: '#2B211B' },
  rosa: { fondo: '#FCF5F4', carta: '#FFFDFD', tenue: '#6E5A5F', inchiostro: '#2E1E22', marchio: '#A63D57', accento: '#F2CBD2', scuro: '#3A2229' },
  verde: { fondo: '#F5F6EF', carta: '#FEFEFB', tenue: '#5C6457', inchiostro: '#1F2A1F', marchio: '#4E6B3A', accento: '#D5DFC4', scuro: '#1F2A1F' },
  blu: { fondo: '#F4F6F9', carta: '#FFFFFF', tenue: '#56606C', inchiostro: '#1C2430', marchio: '#2F5D8A', accento: '#CFDDEA', scuro: '#1C2430' },
  terracotta: { fondo: '#FBF3EC', carta: '#FFFCF9', tenue: '#6C5A4F', inchiostro: '#2C1E16', marchio: '#A8432A', accento: '#EDC9B0', scuro: '#2C1E16' },
  oro: { fondo: '#FAF7EF', carta: '#FFFEFA', tenue: '#665E4C', inchiostro: '#26211A', marchio: '#7E5F14', accento: '#E8DAB0', scuro: '#26211A' },
} as const;
export type Palette = keyof typeof PALETTE;
export const PALETTE_NOMI = Object.keys(PALETTE) as Palette[];

export type Momento = { titolo: string; testo: string; disegno: Disegno };
export type Motivo = { titolo: string; testo: string };
export type Categoria = { categoria: string; descrizione: string; voci: string[]; disegno: Disegno };
export type Racconto = { titolo: string; paragrafi: string[] };

export type ContenutoSito = {
  /** Sopra al titolo, in corsivo: «colazioni · pranzi · aperitivi». */
  occhiello: string;
  /** Il titolo della copertina, che racconta il posto: «Il bar rosa di Piazza Duomo». */
  titolo: string;
  sottotitolo: string;
  momentiTitolo: string;
  momentiIntro: string;
  momenti: Momento[];
  perche: Motivo[];
  locale: Racconto | null;
  offerta: Categoria[];
  citta: (Racconto & { vicino: string[] }) | null;
  comeArrivare: string | null;
  novita: Racconto | null;
  domande: { domanda: string; risposta: string }[];
  palette: Palette;
};

const PAROLA_DEL_DISEGNO: Partial<Record<Disegno, string>> = {
  cornetto: 'colazioni', panino: 'pranzi', calice: 'aperitivi', tazza: 'caffè', vino: 'vini', pizza: 'pizza', gelato: 'gelati', torta: 'dolci', pane: 'pane', fiore: 'fiori',
};

/** La tavolozza che dicono i testi («un bar rosa» → rosa); senza indizi, crema. */
export function paletteDaiTesti(testi: string[]): Palette {
  const t = testi.join(' ').toLowerCase();
  if (/\brosa\b|\brosato\b/.test(t)) return 'rosa';
  if (/\bverde\b|\bgiardino\b|\bpiante\b/.test(t)) return 'verde';
  if (/\bblu\b|\bazzurr|\bmare\b/.test(t)) return 'blu';
  if (/\bmattoni\b|\bcotto\b|\bterracotta\b/.test(t)) return 'terracotta';
  return 'crema';
}

const prima = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Dai testi a pagine del primo sito (28/11 mattina) al modello nuovo. Le sezioni si riconoscono dal titolo:
 * colazione, pranzo, aperitivo diventano i momenti e l'offerta; «il nostro locale» il racconto del posto;
 * «come raggiungerci» il come arrivare. Le pagine arrivano già ripulite dalle frasi da bozza.
 */
export function contenutoDaPagine(pagine: PaginaDellaBozza[], nome: string, sottotitolo: string): ContenutoSito {
  const tutte = pagine.flatMap((p) => p.sezioni.map((s) => ({ ...s, pagina: p.percorso })));
  const usate = new Set<string>();
  const prendi = (re: RegExp) => {
    const s = tutte.find((x) => !usate.has(x.titolo) && re.test(x.titolo));
    if (s) usate.add(s.titolo);
    return s ?? null;
  };

  const panoramica = prendi(/\bdall[ae']?\b.*\ball[ae']?\b|giornata|cosa trov/i);
  const arrivare = prendi(/raggiung|arrivar|dove siamo|come trovar/i);
  // Il racconto del posto: tutte le sezioni che parlano del locale («Benvenuti», «Il nostro locale»), non solo la prima.
  // Il titolo è quello che dice «locale» o «chi siamo», se c'è. (Collaudo a occhio del 28/11: «Il nostro locale»
  // finiva fra i momenti della giornata al posto dell'aperitivo.)
  const RACCONTO = /locale|chi siamo|benvenut|storia|la nostra|il nostro/i;
  const racconto = tutte.filter((x) => !usate.has(x.titolo) && RACCONTO.test(x.titolo));
  racconto.forEach((x) => usate.add(x.titolo));
  const titoloRacconto = racconto.find((x) => /locale|chi siamo|storia/i.test(x.titolo))?.titolo ?? racconto[0]?.titolo ?? 'Chi siamo';

  // Collaudo 28/11: le sezioni senza un disegno riconoscibile si perdevano (il parrucchiere perdeva «Colore» e
  // «Barba»). Ora ogni sezione rimasta è una voce dell'offerta, col disegno che le va meglio o la stella; quelle che
  // la home dell'AD aveva come presentazione vanno nel racconto del locale.
  const restanti = tutte.filter((x) => !usate.has(x.titolo));
  const presentazioni = racconto.length ? restanti.filter((x) => x.pagina === '/' && disegnoPer(`${x.titolo} ${x.testo}`) === 'stella') : [];
  presentazioni.forEach((x) => usate.add(x.titolo));
  const categorie: Categoria[] = tutte
    .filter((x) => !usate.has(x.titolo))
    .map((x) => {
      usate.add(x.titolo);
      return { categoria: x.titolo, descrizione: x.testo, voci: [], disegno: disegnoPer(`${x.titolo} ${x.testo}`) };
    });

  const resto = presentazioni;
  // I momenti: prima le categorie col loro disegno, poi le altre.
  const ordinate = [...categorie.filter((c) => c.disegno !== 'stella'), ...categorie.filter((c) => c.disegno === 'stella')];
  const momenti: Momento[] = ordinate.slice(0, 3).map((c) => ({ titolo: c.categoria, testo: c.descrizione, disegno: c.disegno }));
  const dalleParole = [...new Set(categorie.map((c) => PAROLA_DEL_DISEGNO[c.disegno]).filter((p): p is string => !!p))].slice(0, 4);
  const parole = dalleParole.length ? dalleParole : categorie.slice(0, 3).map((c) => c.categoria.toLowerCase());

  return {
    occhiello: parole.join(' · '),
    titolo: nome,
    sottotitolo,
    momentiTitolo: panoramica?.titolo ?? 'Cosa trovi da noi',
    momentiIntro: panoramica?.testo ?? '',
    momenti,
    perche: [],
    locale: racconto.length ? { titolo: titoloRacconto, paragrafi: [...racconto.map((r) => r.testo), ...resto.map((r) => r.testo)] } : null,
    offerta: categorie,
    citta: null,
    comeArrivare: arrivare?.testo ?? null,
    novita: null,
    domande: [],
    palette: paletteDaiTesti([sottotitolo, ...tutte.map((x) => x.testo)]),
  };
}

/** Un disegno scritto dall'AD che non è nella lista diventa quello che va meglio col titolo. */
export const disegnoValido = (d: unknown, titolo: string): Disegno => (typeof d === 'string' && (DISEGNI as readonly string[]).includes(d) ? (d as Disegno) : disegnoPer(titolo));

export { prima };
