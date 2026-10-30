/**
 * Quando arriva l'ordine: quali fasce si possono davvero scegliere, e cosa si scrive sull'ordine.
 *
 * TRE DIFETTI NELLO STESSO RIQUADRO — «Quando vuoi riceverlo», al checkout, un attimo prima di
 * pagare. Tutti e tre dicono alla persona un orario che non può succedere.
 *
 * ① L'ORDINE NASCEVA CON UN APPUNTAMENTO GIÀ PASSATO. Le fasce di oggi finiscono alle 18 e alle
 *    20. Dalle 20:00 in poi non ne resta nessuna, e la lista si svuota. Ma il giorno restava
 *    «oggi» — la mattonella non si spegneva mai — e la fascia di partenza ripiegava sulla PRIMA
 *    voce, «In giornata · 15:00–18:00». Quella stringa finiva nel corpo della richiesta e su
 *    `orders.delivery_slot`. Alle 21:40 nasceva un ordine con scritto sopra «arriva fra le 15 e le
 *    18», e nessuno lo fermava. Non è un testo sbagliato: è un appuntamento nel passato preso con
 *    un negoziante che poi deve consegnarlo.
 *
 * ② TRE PROMESSE DIVERSE NELLO STESSO RIQUADRO. La mattonella «Adesso» diceva «~30–45 min», la
 *    riga sotto «In 30-60 minuti dalla conferma del negozio», e la fascia preselezionata «In
 *    giornata · 15:00–18:00». Tre risposte alla stessa domanda, nel momento della decisione.
 *
 * ③ LA RIGA CHE NON ASCOLTAVA. Quel «In 30-60 minuti» era un testo fisso: chi sceglieva «Domani ·
 *    9:00–12:00» continuava a leggere che arrivava in mezz'ora.
 *
 * ── Perché un file invece di tre correzioni ─────────────────────────────────────────────────
 * Perché la radice è una sola: **non esisteva un posto che rispondesse alla domanda**. Il numero
 * dei minuti stava scritto a mano in due punti mentre `EXPRESS_ETA_LABEL` esiste dal giorno in cui
 * qualcuno l'ha deciso; la fascia di partenza la sceglieva una funzione che non sapeva dire «oggi
 * non si può»; e la mattonella «Oggi» non chiedeva niente a nessuno. Correggere i tre testi lascia
 * in piedi il meccanismo, e il quarto punto nasce sbagliato il mese prossimo.
 *
 * ── La regola, ed è la stessa di tutta questa casa ──────────────────────────────────────────
 * Le risposte sono TRE, non due: **non serve** (ritiro in negozio) · **questa fascia** ·
 * **non-valida**. La terza è quella che mancava, e ripiegava sulla peggiore. Un ordine con una
 * fascia non valida NON parte: la conferma resta ferma e lo dice.
 *
 * 🟢 Puro: nessuna rete, nessun orologio dentro. L'ora si passa da fuori — così le prove possono
 * mettersi alle 21:40 senza aspettare le 21:40.
 */
import { EXPRESS_ETA_LABEL } from './delivery';
import { motivoNegozioChiuso, negozioPuoServire, romeNow } from './store-hours';

export type Giorno = 'now' | 'today' | 'tomorrow';

/**
 * 30/10/2026 (ondata 22) — LE SETTE FASCE DI NICOLA, UGUALI PER OGGI E PER DOMANI.
 *
 * Scelta di Nicola (30/10 23:15, fatto `consegna.fasce-orarie`). Le fasce di prima (oggi 15-18 e
 * 18-20, domani 9-12, 12-15, 15-18:30, 18:30-20) non seguivano gli orari veri: alle 15:00 di un
 * giorno feriale nessuno dei 9 negozi di Piacenza con orario trovato è aperto
 * (consegne/intelligence/2026-10-30-orari-negozi-piacenza.md), e quasi tutti chiudono fra le 19 e
 * le 19:30. I minuti sono quelli dell'orologio di Roma, dalla mezzanotte.
 */
const ORARI_DELLE_FASCE: readonly { orario: string; daMinuti: number; aMinuti: number }[] = [
  { orario: '7:30–9:00', daMinuti: 7 * 60 + 30, aMinuti: 9 * 60 },
  { orario: '9:00–11:00', daMinuti: 9 * 60, aMinuti: 11 * 60 },
  { orario: '11:00–13:00', daMinuti: 11 * 60, aMinuti: 13 * 60 },
  { orario: '13:00–16:30', daMinuti: 13 * 60, aMinuti: 16 * 60 + 30 },
  { orario: '16:30–18:00', daMinuti: 16 * 60 + 30, aMinuti: 18 * 60 },
  { orario: '18:00–19:30', daMinuti: 18 * 60, aMinuti: 19 * 60 + 30 },
  { orario: '19:30–21:00', daMinuti: 19 * 60 + 30, aMinuti: 21 * 60 },
];

/** Una fascia di oggi coi suoi minuti. `oraDiFine` resta per chi la leggeva (19:30 = 19.5). */
export type FasciaDiOggi = { etichetta: string; daMinuti: number; aMinuti: number; oraDiFine: number };

/**
 * Le fasce di oggi, ognuna con l'ora in cui FINISCE: è quella che conta per la regola dei 60
 * minuti. Le etichette seguono la forma di sempre: «Oggi · 16:30–18:00».
 */
export const FASCE_DI_OGGI: FasciaDiOggi[] = ORARI_DELLE_FASCE.map((f) => ({
  etichetta: `Oggi · ${f.orario}`,
  daMinuti: f.daMinuti,
  aMinuti: f.aMinuti,
  oraDiFine: f.aMinuti / 60,
}));

export const FASCE_DI_DOMANI: string[] = ORARI_DELLE_FASCE.map((f) => `Domani · ${f.orario}`);

/**
 * LE FASCE DI PRIMA (fino al 30/10/2026). La cassa non le propone più.
 *
 * Restano lette per due motivi: sono scritte sugli ordini già nati (`orders.delivery_slot`, che
 * leggono la scadenza, le email e la pagina dell'ordine), e una cassa aperta prima del rilascio
 * le può ancora mandare. Le rotte le giudicano con la stessa regola delle nuove: lunedì alle 17:50
 * «In giornata · 15:00–18:00» prende il 409 dei 60 minuti, con la carta come coi contanti.
 */
export const FASCE_DI_PRIMA: readonly { etichetta: string; giorno: 'oggi' | 'domani'; daMinuti: number; aMinuti: number }[] = [
  { etichetta: 'In giornata · 15:00–18:00', giorno: 'oggi', daMinuti: 15 * 60, aMinuti: 18 * 60 },
  { etichetta: 'Stasera · 18:00–20:00', giorno: 'oggi', daMinuti: 18 * 60, aMinuti: 20 * 60 },
  { etichetta: 'Domani · 9:00–12:00', giorno: 'domani', daMinuti: 9 * 60, aMinuti: 12 * 60 },
  { etichetta: 'Domani · 12:00–15:00', giorno: 'domani', daMinuti: 12 * 60, aMinuti: 15 * 60 },
  { etichetta: 'Domani · 15:00–18:30', giorno: 'domani', daMinuti: 15 * 60, aMinuti: 18 * 60 + 30 },
  { etichetta: 'Domani · 18:30–20:00', giorno: 'domani', daMinuti: 18 * 60 + 30, aMinuti: 20 * 60 },
];

/** La finestra in cui un rider c'è davvero. Fuori da qui l'express non si offre. */
export const APERTURA_EXPRESS = 8;
export const CHIUSURA_EXPRESS = 21;

/** La promessa dell'express, presa da dove è decisa e non riscritta a mano. */
export const ETICHETTA_ADESSO = `Adesso · arrivo in ${EXPRESS_ETA_LABEL}`;
export const SOTTOTITOLO_ADESSO = EXPRESS_ETA_LABEL;

/**
 * TUTTE le fasce che una rotta può ricevere: l'express, le sette di oggi, le sette di domani e
 * quelle di prima (lette, mai proposte).
 *
 * ⚠️ Questo elenco è un CANCELLO, non una comodità. La fascia scelta viaggia dal browser fino
 * alle due rotte che creano gli ordini, e lì decide se il negozio può servire: una fascia per
 * domani fa guardare gli orari di domani invece dell'orologio di adesso. Finché era testo
 * libero bastava scrivere la parola «domani» per far rispondere «sì» a un negozio chiuso —
 * alle 3 di notte nasceva un ordine che nessuno avrebbe preparato.
 *
 * Chi aggiunge una fascia la aggiunge qui sopra e la trova ammessa da sola. Chi ne inventa una
 * dal browser non entra: `lib/ordini/fascia-consegna.ts` rifiuta la richiesta, e
 * `lib/store-hours.ts` non la legge nemmeno come una finestra.
 */
export const FASCE_AMMESSE: readonly string[] = [
  ETICHETTA_ADESSO,
  ...FASCE_DI_OGGI.map((f) => f.etichetta),
  ...FASCE_DI_DOMANI,
  ...FASCE_DI_PRIMA.map((f) => f.etichetta),
];

/** Vero solo per le etichette qui sopra. Il confronto è esatto: niente interpretazioni. */
export function fasciaAmmessa(valore: unknown): valore is string {
  return typeof valore === 'string' && FASCE_AMMESSE.includes(valore);
}

/**
 * Di che giorno parla un'etichetta, letto dall'ELENCO che la genera e non da una parola dentro
 * il testo. `null` per tutto ciò che non è una fascia nota.
 */
export function finestraDellaFascia(
  etichetta: string | null | undefined,
): { giorno: 'oggi' | 'domani'; daMinuti: number; aMinuti: number } | null {
  const oggi = FASCE_DI_OGGI.find((f) => f.etichetta === etichetta);
  if (oggi) return { giorno: 'oggi', daMinuti: oggi.daMinuti, aMinuti: oggi.aMinuti };
  const domani = FASCE_DI_DOMANI.indexOf(String(etichetta));
  if (domani >= 0) {
    const f = ORARI_DELLE_FASCE[domani];
    return { giorno: 'domani', daMinuti: f.daMinuti, aMinuti: f.aMinuti };
  }
  const prima = FASCE_DI_PRIMA.find((f) => f.etichetta === etichetta);
  return prima ? { giorno: prima.giorno, daMinuti: prima.daMinuti, aMinuti: prima.aMinuti } : null;
}

/** «adesso», «oggi», «domani», oppure `null` se l'etichetta non è una fascia nota. */
export function giornoDellaFascia(etichetta: string | null | undefined): 'adesso' | 'oggi' | 'domani' | null {
  if (etichetta === ETICHETTA_ADESSO) return 'adesso';
  return finestraDellaFascia(etichetta)?.giorno ?? null;
}

/**
 * 30/10/2026 (ondata 21) — UNA FASCIA SI SCEGLIE FINO A 60 MINUTI PRIMA DELLA SUA FINE.
 *
 * Scelta di Nicola (fatto `consegna.fascia-fino-a-60-minuti`). Prima la fascia restava
 * proponibile finché non era finita: lunedì alle 17:50 la cassa segnava da sola «In giornata ·
 * 15:00–18:00», cioè «arriva entro dieci minuti», meno della veloce (30-60 min), e la rotta
 * accettava. Nessun fattorino ce la fa. È anche il margine della regola del ritiro
 * (`negozioPuoServire`): il negozio deve essere aperto prima di quest'ora dalla fine.
 */
export const MINUTI_PRIMA_DELLA_FINE = 60;

/** Un'ora intera (le 17 = 17:00) oppure l'orologio di Roma, coi minuti. */
function minutiDi(adesso: number | Date): number {
  return typeof adesso === 'number' ? adesso * 60 : adesso.getHours() * 60 + adesso.getMinutes();
}

/** È una fascia di oggi (anche di quelle di prima)? Solo per queste conta l'orologio dei 60 minuti. */
export function eFasciaDiOggi(etichetta: string | null | undefined): boolean {
  return finestraDellaFascia(etichetta)?.giorno === 'oggi';
}

/**
 * Perché questa fascia di oggi non si fa più in tempo, o `null` se si fa (o se non è di oggi).
 *
 * È la regola dei 60 minuti, in un posto solo. Vale anche per il negozio senza orari scritti:
 * lì la regola del ritiro non ha niente da chiedere, ma una fascia finita resta finita.
 */
export function fasciaFuoriTempo(etichetta: string | null | undefined, adesso: number | Date): string | null {
  const f = finestraDellaFascia(etichetta);
  if (!f || f.giorno !== 'oggi') return null;
  const mancano = f.aMinuti - minutiDi(adesso);
  if (mancano >= MINUTI_PRIMA_DELLA_FINE) return null;
  if (mancano <= 0) {
    return 'La fascia che hai scelto è già passata. Scegline una ancora disponibile, oppure ordina per domani.';
  }
  return 'La fascia che hai scelto finisce fra meno di un’ora: non si fa più in tempo. Scegline una più tardi, oppure ordina per domani.';
}

/**
 * 30/10/2026 (ondata 22) — LA REGOLA UNICA: QUESTA FASCIA SI PUÒ SERVIRE ADESSO?
 *
 * Due domande, sempre nello stesso ordine: ① i 60 minuti (`fasciaFuoriTempo`) ② la regola del
 * ritiro, negozio per negozio (`negozioPuoServire`): ogni negozio del carrello dev'essere aperto
 * in un momento fra adesso e 60 minuti prima della fine della fascia; MyCity tiene la merce da
 * parte fino alla fascia. La usano il selettore, la cassa, la vetrina, la bozza e il freno della
 * veloce: così nessuno propone quello che le rotte rifiutano (`motivoFasciaRifiutata`).
 * Senza orari (lista vuota) resta solo la regola dei 60 minuti, come nelle rotte.
 */
export function fasciaSiPuo(fascia: string, adesso: Date, orari: readonly unknown[] = []): boolean {
  return fasciaFuoriTempo(fascia, adesso) === null && orari.every((h) => negozioPuoServire(h, fascia, adesso));
}

/**
 * La stessa regola, detta come la dicono le rotte: il motivo del 409, o `null` se l'ordine passa.
 * Una casa sola per i contanti e per la carta: stesso controllo, stesso messaggio.
 *
 * L'orologio di Roma si legge una volta sola, e solo se serve (`adesso` lo passano le prove).
 */
export function motivoFasciaRifiutata(
  fascia: string | null | undefined,
  negozi: readonly { nome?: string | null; orari?: unknown }[],
  adesso?: Date,
): string | null {
  const ora = adesso ?? (eFasciaDiOggi(fascia) ? romeNow() : undefined);
  const fuori = ora ? fasciaFuoriTempo(fascia, ora) : null;
  if (fuori) return fuori;
  const chiuso = negozi.find((n) => !negozioPuoServire(n.orari, fascia, ora));
  return chiuso ? motivoNegozioChiuso(chiuso.nome ?? 'Il negozio', fascia, ora) : null;
}

/**
 * Le fasce di oggi che si possono ancora scegliere. Vuota dopo l'ultima.
 *
 * Con l'ora intera (le vecchie chiamate) vale solo la regola dei 60 minuti alle :00. Con
 * l'orologio di Roma è la regola unica (`fasciaSiPuo`): giovedì alle 14:00 Pane Quotidiano non
 * riapre, quindi per oggi non resta niente.
 */
export function fasceAncoraPossibili(ora: number): string[];
export function fasceAncoraPossibili(adesso: Date, orari?: readonly unknown[]): string[];
export function fasceAncoraPossibili(adesso: number | Date, orari: readonly unknown[] = []): string[] {
  return FASCE_DI_OGGI.filter((f) =>
    typeof adesso === 'number' ? fasciaFuoriTempo(f.etichetta, adesso) === null : fasciaSiPuo(f.etichetta, adesso, orari),
  ).map((f) => f.etichetta);
}

/** Le fasce di domani che i negozi del carrello possono servire: sabato sera, per la domenica chiusa, nessuna. */
export function fasceDiDomaniPossibili(adesso: Date, orari: readonly unknown[] = []): string[] {
  return FASCE_DI_DOMANI.filter((f) => fasciaSiPuo(f, adesso, orari));
}

/**
 * Cosa dice la tessera «Oggi» quando è spenta: il motivo vero, come fa già «Domani».
 * «Non più oggi» se anche senza negozi non resta una fascia (dopo le 20:00); altrimenti è il
 * negozio che non si fa trovare aperto in tempo: domenica alle 10, giovedì alle 14.
 */
export function sottotitoloOggiSpento(adesso: Date): 'Non più oggi' | 'Negozio chiuso' {
  return fasceAncoraPossibili(adesso, []).length > 0 ? 'Negozio chiuso' : 'Non più oggi';
}

/** «Oggi» si può ancora scegliere? Dalle 20:01 in poi, no; con gli orari, anche prima. */
export function oggiSiPuoAncora(ora: number): boolean;
export function oggiSiPuoAncora(adesso: Date, orari?: readonly unknown[]): boolean;
export function oggiSiPuoAncora(adesso: number | Date, orari: readonly unknown[] = []): boolean {
  return (typeof adesso === 'number' ? fasceAncoraPossibili(adesso) : fasceAncoraPossibili(adesso, orari)).length > 0;
}

/** L'express si può offrire adesso? */
export function expressSiPuo(ora: number): boolean {
  return ora >= APERTURA_EXPRESS && ora < CHIUSURA_EXPRESS;
}

/**
 * Il giorno da cui partire, aprendo il checkout.
 *
 * Mai uno che non si può scegliere: era il difetto ①, dove si partiva da «oggi» anche a mezzanotte
 * e la fascia ripiegava su una del pomeriggio passato. Con gli orari dei negozi, giovedì alle
 * 14:00 si parte da domani perché oggi il forno non riapre.
 */
export function giornoDiPartenza(ora: number): Giorno;
export function giornoDiPartenza(adesso: Date, orari?: readonly unknown[]): Giorno;
export function giornoDiPartenza(adesso: number | Date, orari: readonly unknown[] = []): Giorno {
  const oggi = typeof adesso === 'number' ? oggiSiPuoAncora(adesso) : oggiSiPuoAncora(adesso, orari);
  return oggi ? 'today' : 'tomorrow';
}

/** La fascia da cui partire per «oggi»: la prima ancora possibile, o nessuna. */
export function fasciaDiPartenzaOggi(ora: number): string | null;
export function fasciaDiPartenzaOggi(adesso: Date, orari?: readonly unknown[]): string | null;
export function fasciaDiPartenzaOggi(adesso: number | Date, orari: readonly unknown[] = []): string | null {
  return (typeof adesso === 'number' ? fasceAncoraPossibili(adesso) : fasceAncoraPossibili(adesso, orari))[0] ?? null;
}

/** Le tre risposte. La terza è quella che mancava. */
export type Consegna =
  | { tipo: 'non-serve' }
  | { tipo: 'scelta'; etichetta: string }
  | { tipo: 'non-valida'; perche: string };

/**
 * Cosa si scrive sull'ordine.
 *
 * ⚠️ `non-serve` e `non-valida` NON sono la stessa cosa, e prima lo erano: tutt'e due finivano in
 * un `null`, cioè in un ordine spedito senza fascia. Il ritiro in negozio non ha bisogno di una
 * fascia; una fascia passata è un ordine da fermare.
 */
export function consegnaScelta(s: {
  giorno: Giorno;
  ora: number;
  fasciaOggi: string;
  fasciaDomani: string;
  ritiroInNegozio: boolean;
  /**
   * 30/10/2026 (ondata 21) — L'orologio di Roma e gli orari dei negozi del carrello. Con questi,
   * la cassa frena le stesse fasce che la rotta rifiuterebbe (60 minuti, negozio chiuso).
   */
  adesso?: Date;
  orari?: readonly unknown[];
}): Consegna {
  if (s.ritiroInNegozio) return { tipo: 'non-serve' };

  if (s.giorno === 'now') {
    if (!expressSiPuo(s.ora)) {
      return { tipo: 'non-valida', perche: 'A quest’ora la consegna immediata non è disponibile. Scegli una fascia di domani.' };
    }
    return { tipo: 'scelta', etichetta: ETICHETTA_ADESSO };
  }

  if (s.giorno === 'today') {
    const possibili = s.adesso ? fasceAncoraPossibili(s.adesso, s.orari) : fasceAncoraPossibili(s.ora);
    if (possibili.length === 0) {
      return { tipo: 'non-valida', perche: 'Per oggi non ci sono più fasce disponibili. Scegli Domani.' };
    }
    if (!possibili.includes(s.fasciaOggi)) {
      const fuori = fasciaFuoriTempo(s.fasciaOggi, s.adesso ?? s.ora);
      return {
        tipo: 'non-valida',
        perche: fuori ?? 'In quella fascia il negozio è chiuso. Scegline una ancora disponibile.',
      };
    }
    return { tipo: 'scelta', etichetta: s.fasciaOggi };
  }

  const domani = s.adesso ? fasceDiDomaniPossibili(s.adesso, s.orari) : FASCE_DI_DOMANI;
  if (domani.length === 0) {
    return { tipo: 'non-valida', perche: 'Domani i negozi del carrello sono chiusi: per ora non c’è una fascia di consegna.' };
  }
  if (!domani.includes(s.fasciaDomani)) {
    return { tipo: 'non-valida', perche: 'Scegli una fascia per domani.' };
  }
  return { tipo: 'scelta', etichetta: s.fasciaDomani };
}

/** L'etichetta da mandare all'ordine: `null` SOLO quando la fascia non serve. */
export function etichettaPerLOrdine(c: Consegna): string | null {
  return c.tipo === 'scelta' ? c.etichetta : null;
}

/** Si può confermare l'ordine? No su `non-valida`: è il freno che mancava. */
export function siPuoConfermare(c: Consegna): boolean {
  return c.tipo !== 'non-valida';
}

/**
 * La riga sotto le mattonelle, che prima diceva sempre «In 30-60 minuti».
 *
 * Adesso segue la scelta: chi ha scelto domani legge domani. Era il difetto ③.
 */
export function rigaQuandoArriva(c: Consegna): string {
  if (c.tipo === 'non-serve') return 'Ritiro in negozio: nessuna consegna.';
  if (c.tipo === 'non-valida') return c.perche;
  if (c.etichetta === ETICHETTA_ADESSO) {
    return `In ${EXPRESS_ETA_LABEL} dalla conferma del negozio`;
  }
  return c.etichetta;
}
