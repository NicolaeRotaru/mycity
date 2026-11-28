import type { Abbonamento } from '@/lib/agenzia/preventivo';

/**
 * LO STANDARD DEL SITO, ABBONAMENTO PER ABBONAMENTO — 28/11/2026.
 *
 * Nicola, 28/11 verso le 15:30: «crea qualcosa che va a spiegare come deve essere strutturato un sito web in base
 * all'abbonamento e seguire quella linea … l'abbonamento business deve essere nella versione business, deve essere
 * bello figo». Il metro è il sito Business del Caffè di Piacenza, fatto a mano il 27/11
 * (ad-mycity/consegne/clienti/caffe-di-piacenza). Il documento da leggere è
 * ad-mycity/cervello/siti/standard-sito-per-abbonamento.md; QUI c'è la stessa regola scritta per la macchina: il
 * costruttore (`costruisci.ts`) disegna solo queste pagine e queste sezioni, e le prove controllano che ci siano.
 *
 * La regola in una riga: OGNI abbonamento ha un sito che si presenta bene. Il Base è UNA pagina, ma lunga e completa;
 * il Business sono CINQUE pagine, ognuna col suo argomento; il Premium sono SETTE, con le novità del mese e le
 * domande frequenti. La qualità della grafica è la stessa per tutti: cambia quanto si racconta, non quanto è curato.
 */

/** Le sezioni che un sito può avere. Ognuna ha un posto fisso nella pagina, nell'ordine di questa lista. */
export type Sezione =
  | 'copertina' // occhiello, titolo che racconta il posto, sottotitolo, «Aperto ora», due pulsanti, immagine grande
  | 'momenti' // tre schede col disegno a un tratto: i momenti della giornata o le cose che si fanno
  | 'striscia' // quattro immagini in fila: le foto vere, o tessere disegnate finché le foto non ci sono
  | 'locale' // chi siamo: il posto, l'atmosfera, la storia vera se la conosciamo
  | 'offerta' // cosa trovi, per categorie, senza prezzi; le voci solo se le conosciamo
  | 'perche' // tre motivi per venire, veri
  | 'citta' // la zona, cosa c'è vicino, e gli appuntamenti in città del mese (dal piano editoriale)
  | 'novita' // la novità del mese, aggiornata ogni mese (Premium)
  | 'domande' // domande frequenti, solo con risposte che conosciamo (Premium)
  | 'galleria' // tutte le foto vere (dal Business in su, se ci sono)
  | 'contatti'; // indirizzo, come arrivare, orari con oggi in evidenza, Chiama e Indicazioni

/** Una pagina del sito: il percorso, il titolo nel menu e le sezioni, nell'ordine. */
export type PaginaStandard = { percorso: string; titolo: string; sezioni: Sezione[]; facoltativa?: boolean };

/**
 * Le pagine per abbonamento. `facoltativa`: la pagina c'è solo se ha qualcosa di vero da dire (le domande senza
 * risposte certe non si inventano). Home e Contatti ci sono sempre.
 */
export const STANDARD: Record<Abbonamento, PaginaStandard[]> = {
  // «Una pagina col vostro nome»: tutto in una pagina sola, dalla copertina ai contatti.
  base: [
    { percorso: '/', titolo: 'Home', sezioni: ['copertina', 'momenti', 'striscia', 'locale', 'offerta', 'perche', 'contatti'] },
  ],
  // «Più pagine col vostro nome»: come il Caffè di Piacenza.
  business: [
    { percorso: '/', titolo: 'Home', sezioni: ['copertina', 'momenti', 'striscia', 'perche', 'citta', 'contatti'] },
    { percorso: '/il-locale', titolo: 'Il locale', sezioni: ['locale', 'galleria', 'perche'] },
    { percorso: '/cosa-offriamo', titolo: 'Cosa offriamo', sezioni: ['offerta'] },
    { percorso: '/in-citta', titolo: 'In città', sezioni: ['citta'], facoltativa: true },
    { percorso: '/contatti', titolo: 'Contatti', sezioni: ['contatti'] },
  ],
  // «Più pagine, aggiornato da noi ogni mese»: il Business più le novità del mese e le domande frequenti.
  premium: [
    { percorso: '/', titolo: 'Home', sezioni: ['copertina', 'momenti', 'striscia', 'novita', 'perche', 'citta', 'contatti'] },
    { percorso: '/il-locale', titolo: 'Il locale', sezioni: ['locale', 'galleria', 'perche'] },
    { percorso: '/cosa-offriamo', titolo: 'Cosa offriamo', sezioni: ['offerta'] },
    { percorso: '/novita', titolo: 'Novità', sezioni: ['novita'], facoltativa: true },
    { percorso: '/in-citta', titolo: 'In città', sezioni: ['citta'], facoltativa: true },
    { percorso: '/domande', titolo: 'Domande', sezioni: ['domande'], facoltativa: true },
    { percorso: '/contatti', titolo: 'Contatti', sezioni: ['contatti'] },
  ],
};

/**
 * Quello che ogni sito ha, qualunque abbonamento (il «minimo del Base»): sono le cose che il Caffè di Piacenza ha e
 * il primo sito automatico del 28/11 no. Le prove le cercano tutte, in tutte e tre le fasce.
 */
export const OGNI_SITO_HA = [
  'barra in alto col nome e il pulsante per chiamare o arrivare',
  'copertina con occhiello, un titolo che racconta il posto e due pulsanti',
  'tre schede col disegno a un tratto',
  'una striscia di immagini',
  'indirizzo, come arrivare e pulsante Indicazioni',
  'orari con il giorno di oggi in evidenza e «Aperto ora», quando il negozio li ha scritti',
  'barra fissa sul telefono con Chiama e Indicazioni',
  'piè di pagina scuro coi contatti e le pagine',
  'titolo e descrizione per Google in ogni pagina, e i dati del locale per Google',
] as const;

/** I vecchi percorsi del primo sito (28/11 mattina): portano alla pagina che ne ha preso il posto. */
export const PERCORSI_DI_PRIMA: Readonly<Record<string, string>> = {
  '/chi-siamo': '/il-locale',
  '/dove-siamo': '/contatti',
};
