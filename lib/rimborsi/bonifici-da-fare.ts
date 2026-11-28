/**
 * IL BONIFICO DI RIMBORSO DA FARE A MANO (R71).
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico, e quel bonifico lo
 * fa a mano chi amministra MyCity. Sul sito non c'è un IBAN salvato (decisione di
 * Nicola del 17/10/2026, «Semplifica»): `refundOrder` scrive il segno
 * `bonifico:<centesimi>:<chiave>` sull'ordine e manda a ogni amministratore un
 * avviso che porta dentro tutto quello che serve per pagare. L'IBAN lo chiede
 * l'email del rimborso: il cliente risponde con i dati del conto.
 *
 * 26/11/2026 — IL BONIFICO SI SEGNA «FATTO». Il registro dei fatti di Nicola
 * (pagamenti.rimborso-contanti, 29/10) dice: il bonifico lo fa Nicola dall'app
 * della banca, «poi tocca "fatto"». La pagina /admin/bonifici-rimborso elenca i
 * bonifici dei segni, ordinati per termine, con «Fatto» e «Respinto dalla banca»
 * (migrazione 910: un bonifico si segna fatto una volta sola, e un secondo
 * amministratore legge chi l'ha già fatto e quando).
 *
 * Qui stanno il segno, i testi degli avvisi e i conti della pagina. Funzioni pure.
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
 * LA CAUSALE DEL BONIFICO. Porta il numero dell'ordine e il reso o il reclamo,
 * perché sullo stesso ordine possono esserci due rimborsi col bonifico, e il
 * secondo non è pagato dal primo. Se un bonifico è già fatto lo dice la pagina
 * dei bonifici, non i movimenti del conto: un bonifico respinto dalla banca
 * lascia la causale fra i movimenti, ma il cliente non ha avuto niente.
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
export const GIORNI_PER_RIMBORSARE = 14;

/** La pagina dei bonifici di rimborso, con «Fatto» e «Respinto dalla banca» (app/admin/bonifici-rimborso). */
export const PAGINA_DEI_BONIFICI = '/admin/bonifici-rimborso';

/** A quanti giorni dal termine un bonifico ancora da fare va in evidenza. */
export const GIORNI_DI_PREAVVISO = 3;

/**
 * IL TERMINE DEL BONIFICO: 14 giorni di calendario a Piacenza dal giorno della
 * richiesta (per un reso, quando il cliente l'ha chiesto: lo stesso giorno che
 * `avanza` e `decide` passano all'avviso). Senza quel giorno il termine non si sa.
 */
export function termineDelBonifico(chiestoIl: string | null | undefined): Date | null {
  const chiesto = chiestoIl ? new Date(chiestoIl) : null;
  if (!chiesto || Number.isNaN(chiesto.getTime())) return null;
  return giornoPiu(chiesto, GIORNI_PER_RIMBORSARE);
}

/** Quanto manca al termine, a giorni di calendario di Piacenza (0 = scade oggi). */
export type UrgenzaDelTermine =
  | { tipo: 'sconosciuto' }
  | { tipo: 'passato'; giorni: number }
  | { tipo: 'vicino'; giorni: number }
  | { tipo: 'in_tempo'; giorni: number };

export function urgenzaDelTermine(termine: Date | null, adesso: Date): UrgenzaDelTermine {
  if (!termine) return { tipo: 'sconosciuto' };
  const giorni = Math.round((termine.getTime() - giornoPiu(adesso, 0).getTime()) / 86_400_000);
  if (giorni < 0) return { tipo: 'passato', giorni: -giorni };
  if (giorni <= GIORNI_DI_PREAVVISO) return { tipo: 'vicino', giorni };
  return { tipo: 'in_tempo', giorni };
}

/** La riga del termine come la legge chi paga. */
export function fraseDelTermine(termine: Date | null, adesso: Date): string {
  const u = urgenzaDelTermine(termine, adesso);
  if (u.tipo === 'sconosciuto' || !termine) {
    return `Termine sconosciuto: manca il giorno da cui contare i ${GIORNI_PER_RIMBORSARE} giorni. Pagalo appena hai l'IBAN.`;
  }
  const giorno = data(termine);
  if (u.tipo === 'passato') return `Termine passato da ${u.giorni} ${u.giorni === 1 ? 'giorno' : 'giorni'} (${giorno}).`;
  if (u.tipo === 'vicino') {
    if (u.giorni === 0) return `Scade oggi (${giorno}).`;
    if (u.giorni === 1) return `Scade domani (${giorno}).`;
    return `Mancano ${u.giorni} giorni al termine (${giorno}).`;
  }
  return `Termine: ${giorno}, fra ${u.giorni} giorni.`;
}

/**
 * L'AVVISO DEL BONIFICO DA FARE. Tutto quello che serve per pagare sta nel testo,
 * e il link porta alla pagina dei bonifici, dove si segna «Fatto».
 *
 *  · la cifra del bonifico: solo i contanti, mai l'intero rimborso;
 *  · quanto è già tornato come credito MyCity (la parte pagata col credito);
 *  · l'email del cliente letta adesso, e da quale indirizzo accettare l'IBAN;
 *    senza email (account cancellato), come riconoscere il cliente vero;
 *  · la causale fissa, una per reso o reclamo;
 *  · il giorno della richiesta e il termine dei 14 giorni, o che il termine non si sa;
 *  · se il termine è già passato o mancano 3 giorni o meno, quanto manca (o da quanto è passato);
 *  · dove si segna «Fatto» (e «Respinto dalla banca»).
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
  /** Quando il cliente ha chiesto il reso (o aperto il reclamo): da lì partono i 14 giorni. */
  resoChiestoIl?: string | null;
  /** La casella dove arrivano le risposte dei clienti. */
  casella?: string;
  /** Adesso (di default l'orologio): per dire se il termine è già passato o vicino. */
  adesso?: Date;
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
  const termine = termineDelBonifico(a.resoChiestoIl);
  if (termine && a.resoChiestoIl) {
    const chiesto = new Date(a.resoChiestoIl);
    frasi.push(
      /^dispute_/.test(a.chiave ?? '')
        ? `Il reclamo è stato aperto il ${data(chiesto)}: contiamo ${GIORNI_PER_RIMBORSARE} giorni da lì, quindi il termine è il ${data(termine)}.`
        : `Il reso è stato chiesto il ${data(chiesto)}: la legge dà ${GIORNI_PER_RIMBORSARE} giorni da lì, quindi il termine è il ${data(termine)}.`,
    );
    // 27/11/2026 — Un reso rimborsato quando il pacco torna indietro arriva spesso a ridosso dei 14
    // giorni, o dopo: l'avviso diceva solo la data, e un termine già passato non lo segnava nessuno.
    const adesso = a.adesso ?? new Date();
    const urgenza = urgenzaDelTermine(termine, adesso).tipo;
    if (urgenza === 'passato' || urgenza === 'vicino') frasi.push(fraseDelTermine(termine, adesso));
  } else {
    frasi.push(`Il termine non lo sappiamo: manca il giorno da cui contare i ${GIORNI_PER_RIMBORSARE} giorni. Pagalo appena hai l'IBAN.`);
  }
  // 26/11/2026 — Il «fatto» si segna sulla pagina dei bonifici, una volta sola (migrazione 910).
  // La frase dei movimenti del conto e il link agli ordini restano finché due prove comuni li
  // fissano (il-rimborso-dei-contanti-arriva-col-bonifico, un-reclamo-su-contanti-mai-incassati…):
  // poi la frase si toglie e il link diventa PAGINA_DEI_BONIFICI.
  frasi.push(
    `Nella causale del bonifico scrivi «${causale}». Questo avviso arriva a ogni amministratore: ` +
      "prima di pagare cerca questa causale nei movimenti del conto. Se c'è, è già pagato.",
  );
  frasi.push(
    "Quando hai fatto il bonifico, premi «Fatto» nella pagina «Bonifici di rimborso», e se un altro l'ha già fatto la pagina dice chi e quando. " +
      'Se la banca lo respinge, premi «Respinto dalla banca»: torna fra quelli da fare.',
  );
  frasi.push('Non dargli credito MyCity al posto dei soldi.');

  return { titolo: TITOLO_DEL_BONIFICO_DA_FARE, testo: frasi.join(' '), link: '/admin/orders' };
}

/** Dove arriva l'IBAN del cliente, sulla pagina dei bonifici: lo stesso che dice l'avviso. */
export function doveArrivaLIban(emailCliente: string | null, casella: string = indirizzoContatto('info')): string {
  return emailCliente
    ? `L'IBAN lo manda il cliente rispondendo all'email del rimborso, a ${casella}: prendilo solo da una risposta che arriva da ${emailCliente}.`
    : "Nessun recapito: l'account è stato cancellato. Paga solo se ti dice cosa ha comprato, in che giorno e quanto ha pagato.";
}

/** Una riga di `admin_bonifici_rimborso()` (migrazione 910): un segno sull'ordine col suo esito. */
export type RigaDelBonifico = {
  order_id: string;
  chiave: string;
  centesimi: number;
  cliente_nome: string | null;
  cliente_email: string | null;
  /** Per un reso, quando è stato chiesto: da lì contano i 14 giorni. */
  chiesto_il: string | null;
  /** DA_FARE, FATTO, o RESPINTO (dalla banca: è di nuovo da fare). */
  stato: string;
  fatto_da_nome: string | null;
  fatto_il: string | null;
  respinto_da_nome: string | null;
  respinto_il: string | null;
};

export type BonificoInElenco = RigaDelBonifico & {
  causale: string;
  numeroOrdine: string;
  termine: Date | null;
  urgenza: UrgenzaDelTermine;
  /** Termine sconosciuto, passato, o a 3 giorni o meno. */
  inEvidenza: boolean;
};

/**
 * I CONTI DELLA PAGINA DEI BONIFICI. Da fare: ogni segno non FATTO (anche quelli
 * respinti dalla banca), ordinati per termine; un termine sconosciuto conta come
 * oggi, così sta dopo i passati e prima di quelli che hanno tempo. Fatti: in fondo,
 * l'ultimo per primo.
 */
export function elencoDeiBonifici(
  righe: ReadonlyArray<RigaDelBonifico>,
  adesso: Date,
): { daFare: BonificoInElenco[]; fatti: BonificoInElenco[] } {
  const oggi = giornoPiu(adesso, 0).getTime();
  const tutti = righe.map((r): BonificoInElenco => {
    const termine = termineDelBonifico(r.chiesto_il);
    const urgenza = urgenzaDelTermine(termine, adesso);
    return {
      ...r,
      causale: causaleDelBonifico(r.order_id, r.chiave),
      numeroOrdine: numeroDellOrdine(r.order_id),
      termine,
      urgenza,
      inEvidenza: urgenza.tipo !== 'in_tempo',
    };
  });
  const daFare = tutti
    .filter((b) => b.stato !== 'FATTO')
    .sort((x, y) => (x.termine?.getTime() ?? oggi) - (y.termine?.getTime() ?? oggi) || x.chiave.localeCompare(y.chiave));
  const fatti = tutti
    .filter((b) => b.stato === 'FATTO')
    .sort((x, y) => String(y.fatto_il ?? '').localeCompare(String(x.fatto_il ?? '')));
  return { daFare, fatti };
}

/**
 * GLI ALLARMI DEL TERMINE, per il sorvegliante (app/api/cron/operational-alerts): un bonifico ancora
 * da fare a 3 giorni o meno dal termine, o col termine passato. La chiave porta il tipo, così quando
 * il termine passa arriva un allarme nuovo; il sorvegliante lo ripete una volta al giorno finché il
 * bonifico non è «Fatto». Senza giorno di partenza non c'è termine: quei bonifici restano in evidenza
 * sulla pagina.
 */
export function allarmiDeiBonifici(
  righe: ReadonlyArray<RigaDelBonifico>,
  adesso: Date,
): Array<{ key: string; type: string; detail: string; url: string; unaVoltaAlGiorno: true }> {
  return elencoDeiBonifici(righe, adesso)
    .daFare.filter((b) => b.urgenza.tipo === 'vicino' || b.urgenza.tipo === 'passato')
    .map((b) => {
      const tipo = b.urgenza.tipo === 'passato' ? 'BONIFICO_RIMBORSO_SCADUTO' : 'BONIFICO_RIMBORSO_IN_SCADENZA';
      return {
        key: `${tipo}|${b.chiave}`,
        type: tipo,
        detail:
          `Bonifico di rimborso di ${formatPriceFromCents(b.centesimi)} al cliente dell'ordine ${b.numeroOrdine} ancora da fare ` +
          `(causale «${b.causale}»). ${fraseDelTermine(b.termine, adesso)}`,
        url: PAGINA_DEI_BONIFICI,
        unaVoltaAlGiorno: true as const,
      };
    });
}

/** L'ora (e il giorno, se non è oggi) come la legge una persona, nel fuso di Piacenza. */
function quando(istante: Date, adesso: Date): string {
  const ora = istante.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  return giornoPiu(istante, 0).getTime() === giornoPiu(adesso, 0).getTime()
    ? `alle ${ora}`
    : `il ${istante.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' })} alle ${ora}`;
}

/** Chi l'ha segnato e quando, per la riga di un bonifico fatto o respinto. */
export function chiEQuando(nome: string | null | undefined, il: string | null | undefined, adesso: Date): string {
  const istante = il ? new Date(il) : null;
  const chi = nome?.trim() || 'un amministratore';
  return istante && !Number.isNaN(istante.getTime()) ? `da ${chi} ${quando(istante, adesso)}` : `da ${chi}`;
}

/** La risposta di `admin_segna_bonifico_rimborso` (migrazione 910). */
export type RispostaDelSegno = {
  ok?: boolean;
  reason?: string;
  stato?: string;
  fatto_da_nome?: string | null;
  fatto_il?: string | null;
};

/** Cosa legge chi ha premuto «Fatto» o «Respinto dalla banca». */
export function messaggioDelSegno(r: RispostaDelSegno | null | undefined, adesso: Date): { ok: boolean; testo: string } {
  if (r?.ok) {
    return r.stato === 'RESPINTO'
      ? { ok: true, testo: 'Segnato come respinto dalla banca: è tornato fra i bonifici da fare.' }
      : { ok: true, testo: 'Segnato come fatto.' };
  }
  switch (r?.reason) {
    case 'GIA_FATTO':
      return { ok: false, testo: `Già fatto ${chiEQuando(r.fatto_da_nome, r.fatto_il, adesso)}: non rifarlo.` };
    case 'NON_FATTO':
      return { ok: false, testo: "Questo bonifico risulta ancora da fare: non c'è niente da segnare come respinto." };
    case 'SEGNO_DIVERSO':
    case 'ORDER_NOT_FOUND':
      return { ok: false, testo: "Sull'ordine questo bonifico non c'è più così: ricarica la pagina." };
    default:
      return { ok: false, testo: 'Non sono riuscito a segnarlo: riprova.' };
  }
}

/**
 * Collaudo del 17/10, quarto giro — cosa legge chi ha premuto quando il bonifico e' gia' registrato
 * sull'ordine e finirlo non e' riuscito. Mai «non è partito»: il rimborso c'e', manca un pezzo.
 */
export function bonificoDaFinire(manca: 'avviso' | 'credito'): string {
  return manca === 'credito'
    ? 'Il rimborso è registrato, ma il credito MyCity al cliente non è partito: riprova.'
    : "Il rimborso è registrato, ma l'avviso a chi paga non è partito: riprova.";
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
    // Collaudo finale del 17/10 — il reso si chiama come nella causale qui sotto
    // (6 caratteri maiuscoli): prima la stessa frase lo chiamava in due modi.
    `Il rimborso del reso ${r.resoId.slice(0, 6).toUpperCase()} sull'ordine ${numeroDellOrdine(r.ordineId)} è partito, ` +
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

/**
 * Il titolo della notifica al cliente quando il reso si chiude come rimborsato.
 *
 * Collaudo finale del 17/10 — sui contanti il bonifico e' ancora da fare, quindi
 * il titolo non dice «rimborsato». Ma su un ordine pagato in parte col credito
 * MyCity quella parte e' gia' tornata: il titolo diceva solo «arriva con un
 * bonifico» e taceva il credito gia' disponibile.
 */
export function titoloDelResoRimborsato(r: { importoCents: number; bonificoCents: number }): string {
  if (r.bonificoCents <= 0) return '✓ Reso rimborsato';
  const credito = r.importoCents - r.bonificoCents;
  if (credito > 0) {
    return `✓ Reso chiuso: ${formatPriceFromCents(credito)} sono già tornati come credito MyCity, ` +
      "il resto arriva con un bonifico, ti chiediamo l'IBAN per email";
  }
  return "✓ Reso chiuso: il rimborso arriva con un bonifico, ti chiediamo l'IBAN per email";
}
