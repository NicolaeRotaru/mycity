import { logger } from '@/lib/logger';

/**
 * 8/9/2026 — LA MERCE TORNA A SCAFFALE UNA VOLTA SOLA.
 *
 * `restore_stock_for_order` e' una somma secca: `stock = stock + oi.quantity`.
 * Non porta nessun segno di «gia' fatto», quindi due chiamate sullo stesso
 * ordine sommano due volte. Il negozio ha un pezzo e il sito ne offre due: il
 * secondo cliente paga una cosa che non esiste, e a valle c'e' un rimborso piu'
 * un negoziante che deve dire di no.
 *
 * Fin qui non e' successo per una COINCIDENZA, non per una difesa. Dentro
 * `refundOrder` la merce tornava solo sul rimborso pieno, e il rimborso pieno
 * capita una volta sola: dopo non resta niente da rimborsare e
 * `accumula_rimborso` respinge. La bandiera `annullaLOrdine` — «cliente
 * assente»: la merce torna, ma al cliente si restituisce l'ordine al netto
 * della consegna — ha allargato la condizione che innesca la somma, senza
 * rendere la somma ripetibile. Restituire 25,00 su 30,00 dichiarando l'annullo
 * chiude l'ordine e rimette la merce; i 5,00 che restano possono uscire dopo —
 * una consegna resa per cortesia, una contestazione risolta piu' tardi — e quel
 * secondo rimborso e' pieno, quindi rimetteva la merce una seconda volta.
 *
 * DUE STRATI, APPOSTA.
 * ① Qui: la decisione, in una funzione pura che una prova puo' eseguire.
 * ② Nel database: la migrazione 160 mette il segno vero
 *    (`orders.stock_restored_at`) e trasforma `restore_stock_for_order` in una
 *    rivendicazione — la prima chiamata prende il turno, le altre non fanno
 *    niente, e vale per tutti e otto i posti che la chiamano, anche contro due
 *    chiamate partite insieme.
 * Servono tutti e due: il codice si pubblica unendo una richiesta, la
 * migrazione la firma Nicola. Fra le due c'e' una finestra, e in quella
 * finestra la difesa deve esserci lo stesso.
 *
 * PERCHE' QUI NON SI LEGGE `stock_restored_at`, CHE SAREBBE ESATTO.
 * Perche' chiederlo nella `select` prima che la 160 sia applicata farebbe
 * fallire la lettura dell'ordine — PostgreSQL non ignora una colonna che non
 * esiste, fa fallire l'istruzione intera — e il ripiego di
 * `lib/db/migrazione-124.ts` ha due tentativi soli: il secondo lascerebbe fuori
 * anche `gross_total_cents`, cioe' la base su cui si calcola quanto si recupera
 * dal negozio. Per leggere un segno del magazzino si sballerebbero i soldi. Il
 * segno lo usa il database, dove non costa niente.
 *
 * NEL DUBBIO NON SI SOMMA. Fra due letture possibili si sceglie sempre quella
 * che NON rimette a scaffale piu' del dovuto: un pezzo che resta invisibile lo
 * vede il negoziante e si sistema in un minuto, un pezzo fantasma lo scopre un
 * cliente che ha gia' pagato.
 */

/** Quel che serve sapere dell'ordine, LETTO PRIMA di questo rimborso. */
export interface OrdinePrimaDelRimborso {
  /**
   * Lo stato della consegna com'era all'inizio della chiamata. E' il segno che
   * lascia chi ha gia' chiuso l'ordine: ogni strada che scrive `CANCELED`
   * rimette anche la merce nella stessa operazione (`cancel_order`,
   * `seller_reject_order`, `annullaERimborsa`, il giro degli ordini fermi, la
   * contestazione persa dal webhook, e questo stesso `refundOrder`).
   */
  delivery_status?: string | null;
}

export interface DomandaScaffale {
  /** Questo rimborso chiude l'ordine? (rimborso pieno, oppure annullo dichiarato) */
  ordineDaChiudere: boolean;
  ordine: OrdinePrimaDelRimborso;
  /**
   * Quanto era gia' stato rimborsato PRIMA di questa chiamata, in centesimi.
   * E' la prova che un rimborso precedente c'e' stato: senza di lui, un ordine
   * gia' annullato l'ha annullato qualcun altro, non un rimborso.
   */
  giaRimborsatoPrimaCents: number;
}

export type DecisioneScaffale =
  | { rimetti: true }
  | { rimetti: false; perche: 'ordine-aperto' | 'gia-chiuso-da-un-rimborso' };

/**
 * La merce di questo ordine va rimessa a scaffale ADESSO?
 *
 * Due no, per due motivi diversi:
 *
 * ① l'ordine resta aperto — un reso parziale non annulla niente e non sposta
 *    un pezzo di magazzino;
 * ② l'ordine era gia' chiuso DA UN RIMBORSO PRECEDENTE, e quel rimborso la
 *    merce l'ha gia' rimessa.
 *
 * Il «DA UN RIMBORSO PRECEDENTE» non e' un dettaglio: e' la riga che tiene in
 * piedi il giro degli ordini fermi. Quello annulla l'ordine PRIMA di chiedere
 * il rimborso, quindi `refundOrder` lo legge gia' `CANCELED` — ma con zero
 * rimborsato, e li' la merce non l'ha ancora rimessa nessuno. Guardare solo lo
 * stato della consegna avrebbe lasciato a magazzino zero ogni ordine scaduto
 * pagato con carta: un difetto nuovo al posto di quello vecchio.
 *
 * QUELLO CHE QUESTA REGOLA NON PUO' VEDERE. Un ordine chiuso con l'annullo
 * dichiarato non lascia la traccia `CANCELED` in due casi: se era gia'
 * `DELIVERED` (la consegna e' avvenuta davvero e non si riscrive, difetto 054)
 * e se e' in contanti (la riconciliazione del contante vuole l'ordine non
 * annullato). Li' il segno lo mette solo il database: la migrazione 160 e'
 * un PREREQUISITO per collegare `annullaLOrdine` a una rotta vera.
 */
export function decidiRimessaAScaffale(domanda: DomandaScaffale): DecisioneScaffale {
  if (!domanda.ordineDaChiudere) return { rimetti: false, perche: 'ordine-aperto' };

  if (domanda.giaRimborsatoPrimaCents > 0 && domanda.ordine.delivery_status === 'CANCELED') {
    return { rimetti: false, perche: 'gia-chiuso-da-un-rimborso' };
  }

  return { rimetti: true };
}

/** Il minimo che serve per parlare col database: cosi' una prova puo' passarne uno finto. */
interface ClientConRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
}

/**
 * Decide e, se e' il caso, chiede al database di rimettere la merce.
 *
 * Casa unica: chi rimette la merce dopo un rimborso passa di qui, cosi' la
 * regola vive in un posto solo invece che ripetuta a ogni chiamata.
 */
export async function rimettiLaMerceAScaffale(
  admin: ClientConRpc,
  ordine: OrdinePrimaDelRimborso & { id: string },
  domanda: Omit<DomandaScaffale, 'ordine'>,
): Promise<DecisioneScaffale> {
  const decisione = decidiRimessaAScaffale({ ...domanda, ordine });
  if (!decisione.rimetti) {
    // Un ordine che resta aperto e' il caso normale e non si annota: un avviso
    // che compare a ogni reso parziale e' un avviso che si impara a ignorare.
    // Si annota il caso raro — la merce era gia' tornata — perche' e' quello
    // che serve leggere quando qualcuno chiedera' «e il magazzino?».
    if (decisione.perche !== 'ordine-aperto') {
      logger.info('[scaffale] merce gia rimessa da un rimborso precedente: non si somma', {
        orderId: ordine.id,
      });
    }
    return decisione;
  }

  const { error } = await admin.rpc('restore_stock_for_order', { p_order_id: ordine.id });
  if (error) {
    // Non si rilancia: il rimborso al cliente e' gia' uscito e non si torna
    // indietro. Il magazzino sbagliato diventa un guasto dichiarato, non un
    // rimborso perso.
    logger.error('[scaffale] merce non rimessa a scaffale', {
      orderId: ordine.id,
      message: error.message,
    });
  }
  return decisione;
}
