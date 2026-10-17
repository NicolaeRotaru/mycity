/**
 * IL BONIFICO DI RIMBORSO DA FARE A MANO (R71).
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico, e quel bonifico lo
 * fa a mano chi amministra MyCity. Sul sito non c'è una pagina dei bonifici né un
 * IBAN salvato (decisione di Nicola del 17/10/2026, «Semplifica»): `refundOrder`
 * scrive il segno `bonifico:<centesimi>:<chiave>` sull'ordine e manda a ogni
 * amministratore un avviso che porta dentro tutto quello che serve per pagare.
 * L'IBAN lo chiede l'email del rimborso: il cliente risponde con i dati del conto.
 *
 * Qui stanno il segno e i testi degli avvisi. Funzioni pure.
 */

import { formatPriceFromCents } from '@/lib/format';
import { indirizzoContatto } from '@/lib/contatti-pubblici';
import { centesimiDelBonificoDalSegno, eUnBonificoDiRimborso, segnoDelBonifico } from '@/lib/stripe/elenco-dei-rimborsi';

// Le funzioni del segno vivono in lib/stripe/elenco-dei-rimborsi.ts, che non dipende da niente.
export { centesimiDelBonificoDalSegno, eUnBonificoDiRimborso, segnoDelBonifico };

/** Il titolo dell'avviso agli amministratori: lo stesso dappertutto. */
export const TITOLO_DEL_BONIFICO_DA_FARE = '💶 Bonifico di rimborso da fare';

/** Il numero dell'ordine come lo vede il cliente: i primi sei caratteri, in maiuscolo (app/orders/[id]/page.tsx). */
function numeroDellOrdine(ordineId: string): string {
  return `#${ordineId.slice(0, 6).toUpperCase()}`;
}

/**
 * LA CAUSALE DEL BONIFICO. L'avviso arriva a ogni amministratore, e sul sito non
 * esiste un «fatto»: chi paga controlla nei movimenti del conto se questa causale
 * c'è già. Porta anche il reso o il reclamo, perché sullo stesso ordine possono
 * esserci due rimborsi col bonifico, e il secondo non è pagato dal primo.
 */
export function causaleDelBonifico(ordineId: string, chiave?: string | null): string {
  const pratica = /^(return|dispute)_(.+)$/.exec(chiave ?? '');
  const dove = pratica ? ` ${pratica[1] === 'return' ? 'reso' : 'reclamo'} ${pratica[2].slice(0, 6).toUpperCase()}` : '';
  return `Rimborso MyCity ordine ${numeroDellOrdine(ordineId)}${dove}`;
}

/** Una data come la legge una persona, nel fuso di Piacenza. */
function data(giorno: Date): string {
  return giorno.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
}

/**
 * Il giorno di calendario a Piacenza, piu' qualche giorno, a mezzogiorno.
 * Collaudo del 17/10 — si sommavano 14 volte 24 ore: vicino al cambio dell'ora
 * il termine usciva un giorno avanti (marzo) o indietro (ottobre). I giorni si
 * sommano alla data, non ai millisecondi.
 */
function giornoPiu(istante: Date, giorni: number): Date {
  const parti = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(istante);
  const n = (tipo: string) => Number(parti.find((p) => p.type === tipo)?.value);
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day') + giorni, 12));
}

/** I giorni che la legge dà per restituire i soldi dopo il recesso (Codice del Consumo, art. 56). */
const GIORNI_PER_RIMBORSARE = 14;

/**
 * L'AVVISO DEL BONIFICO DA FARE. Tutto quello che serve per pagare sta nel testo:
 * il link porta solo alla pagina degli ordini, un punto di arrivo.
 *
 *  · la cifra del bonifico: solo i contanti, mai l'intero rimborso;
 *  · quanto è già tornato come credito MyCity (la parte pagata col credito);
 *  · l'email del cliente letta adesso, e da quale indirizzo accettare l'IBAN;
 *    senza email (account cancellato), come riconoscere il cliente vero;
 *  · la causale fissa, che dice anche se il bonifico è già stato fatto;
 *  · per un reso, la data della richiesta e il termine dei 14 giorni.
 * Nessun IBAN.
 */
export function avvisoDelBonificoDaFare(a: {
  ordineId: string;
  bonificoCents: number;
  creditoCents: number;
  emailCliente: string | null;
  /** La chiave del rimborso (`return_<id>`, `dispute_<id>`): entra nella causale. */
  chiave?: string | null;
  /** Il credito MyCity speso sull'ordine che non torna, perché l'account non c'è più (D5). */
  creditoNonRestituitoCents?: number;
  /** Quando il cliente ha chiesto il reso: da lì partono i 14 giorni. */
  resoChiestoIl?: string | null;
  /** La casella dove arrivano le risposte dei clienti. */
  casella?: string;
}): { titolo: string; testo: string; link: string } {
  const ordine = numeroDellOrdine(a.ordineId);
  const casella = a.casella ?? indirizzoContatto('info');
  const causale = causaleDelBonifico(a.ordineId, a.chiave);
  const frasi: string[] = [];

  frasi.push(
    `Bonifico di ${formatPriceFromCents(a.bonificoCents)} da fare al cliente dell'ordine ${ordine}, pagato in contanti` +
      (a.creditoCents > 0 ? ` (altri ${formatPriceFromCents(a.creditoCents)} gli sono già tornati come credito MyCity).` : '.'),
  );
  if ((a.creditoNonRestituitoCents ?? 0) > 0) {
    frasi.push(
      `Altri ${formatPriceFromCents(a.creditoNonRestituitoCents ?? 0)} erano credito MyCity: non si possono restituire, perché l'account è cancellato.`,
    );
  }
  if (a.emailCliente) {
    frasi.push(
      `Gli scriviamo un'email per chiedergli l'IBAN e il nome dell'intestatario del conto: la risposta arriva a ${casella}. ` +
        `Prendi l'IBAN solo da una risposta che arriva da ${a.emailCliente}. Se entro 3 giorni non risponde, scrivigli tu.`,
    );
  } else {
    frasi.push(
      "Nessun recapito: l'account è stato cancellato. Il numero d'ordine da solo non basta, perché lo vedono anche il negozio e il fattorino: " +
        'paga solo se ti dice cosa ha comprato, in che giorno e quanto ha pagato.',
    );
  }
  const chiesto = a.resoChiestoIl ? new Date(a.resoChiestoIl) : null;
  if (chiesto && !Number.isNaN(chiesto.getTime())) {
    const termine = giornoPiu(chiesto, GIORNI_PER_RIMBORSARE);
    frasi.push(
      `Il reso è stato chiesto il ${data(chiesto)}: la legge dà ${GIORNI_PER_RIMBORSARE} giorni da lì, quindi il termine è il ${data(termine)}.`,
    );
  } else {
    frasi.push('Va pagato presto.');
  }
  frasi.push(
    `Nella causale del bonifico scrivi «${causale}». Questo avviso arriva a ogni amministratore: ` +
      "prima di pagare cerca questa causale nei movimenti del conto. Se c'è, è già pagato.",
  );
  frasi.push('Non dargli credito MyCity al posto dei soldi.');

  return { titolo: TITOLO_DEL_BONIFICO_DA_FARE, testo: frasi.join(' '), link: '/admin/orders' };
}

/** Cosa legge chi ha premuto, quando il rimborso e' partito ma il reso non lo sa. */
export const RIMBORSO_PARTITO_MA_NON_REGISTRATO =
  "Il rimborso è partito ma non si è potuto registrare sul reso: abbiamo avvisato l'amministrazione. Non ripetere il rimborso.";

/**
 * IL RIMBORSO E' PARTITO MA IL RESO NON LO SA (riesame del 16/10).
 *
 * In `avanza` e in `decide` i soldi escono prima, poi si scrive l'esito sul
 * reso. Se la scrittura cade, la rotta non risponde «ok»: chi amministra riceve
 * questo avviso, e il negozio legge che non deve ripetere il rimborso.
 *
 * Collaudo del 17/10, terzo giro — DA `avanza` IL RESO E' GIA' «RIMBORSATO».
 * L'avviso diceva a tutti e due «quando il negozio segna il reso come
 * rimborsato, si registra»: vero dopo `decide` (il reso resta «approvato»),
 * falso dopo `avanza`, dove il turno ha gia' scritto «rimborsato» e un secondo
 * «rimborsato» risponde 409. Li' sul reso manca solo il riferimento del rimborso.
 */
export function avvisoDelRimborsoNonRegistrato(r: {
  resoId: string;
  ordineId: string;
  refundId: string | null;
  bonificoCents: number;
  /** Da `avanza`: il reso risulta gia' rimborsato, non c'e' un passo del negozio che lo registri. */
  resoGiaRimborsato?: boolean;
}): { titolo: string; testo: string; link: string } {
  const inizio =
    `Il rimborso del reso ${r.resoId.slice(0, 8)} sull'ordine ${numeroDellOrdine(r.ordineId)} è partito, ` +
    "ma il reso non l'ha registrato.";
  return {
    titolo: '⚠️ Rimborso partito ma non registrato sul reso',
    testo:
      r.bonificoCents > 0
        ? `${inizio} Dentro c'è un bonifico di ${formatPriceFromCents(r.bonificoCents)}: è lo stesso dell'avviso ` +
          `«Bonifico di rimborso da fare» di quell'ordine, con la causale «${causaleDelBonifico(r.ordineId, `return_${r.resoId}`)}», ` +
          'quindi pagalo una volta sola. ' +
          (r.resoGiaRimborsato
            ? "Il rimborso non va rifatto e sul reso non serve fare altro: risulta già rimborsato, gli manca solo il riferimento del rimborso, che resta scritto sull'ordine."
            : 'Il rimborso non va rifatto: quando il negozio segna il reso come rimborsato, si registra senza ripartire.')
        : `${inizio} Non va rifatto: avvisa tu il negozio di non rimborsarlo di nuovo e di non chiuderlo senza rimborso. ` +
          "Il negozio è scritto nell'ordine, i suoi recapiti in Utenti.",
    link: '/admin/orders',
  };
}
