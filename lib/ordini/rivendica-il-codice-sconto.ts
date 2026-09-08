import { validateCoupon } from '@/lib/coupons';
import {
  MOTIVO_CARTA_ANCORA_APERTA,
  type RiserveLiberate,
} from '@/lib/ordini/ordine-in-contanti-puo-nascere';

/**
 * IL CODICE SCONTO SI RIVENDICA SOLO DOPO AVER LIBERATO QUELLO CHE IL CLIENTE
 * TENEVA GIÀ IN OSTAGGIO.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Un tentativo di pagamento abbandonato tiene in ostaggio DUE cose del cliente:
 * la merce (`reserve_stock`) e il codice sconto (`claim_coupon`). La pulizia
 * che le restituisce entrambe esiste — `liberaRiserveAbbandonate` — ma nella
 * cassa con la carta era stata messa dove serviva alla MERCE: subito prima di
 * riservare, cioè 130 righe DOPO il punto in cui il codice sconto viene
 * richiesto di nuovo.
 *
 * Cosa vedeva la persona. Il codice `BENVENUTO5` vale una volta sola. Maria
 * preme «Paga con carta»: il codice risulta usato e la pagina di Stripe si
 * apre. Torna indietro per spostare la consegna da «oggi pomeriggio» a
 * «domani mattina» e ripreme: il carrello è cambiato, quindi non si riusa la
 * pagina di prima, e la cassa le risponde «Coupon non valido: Codice
 * esaurito». Esaurito da lei, un minuto prima, per un ordine che non esiste.
 * La riga che glielo avrebbe restituito c'era, ma girava più in basso e la
 * richiesta moriva prima di arrivarci. Per un codice a uso unico vuol dire
 * perso: non lo recupera nessuno prima delle due ore di scadenza, e a quel
 * punto Maria se n'è andata.
 *
 * ── La cura, e perché è strutturale ─────────────────────────────────────────
 * Non basta spostare una riga più in su: fra un mese qualcuno la sposta di
 * nuovo. Qui la rivendicazione del codice **pretende in ingresso il resoconto
 * della pulizia** (`RiserveLiberate`), che esiste solo se `liberaRiserveAbbandonate`
 * è già stata eseguita. Chi scrive la rotta non può più chiedere il codice
 * prima di aver liberato: non gli si compila.
 *
 * È lo stesso schema già usato per i contanti (`ordineInContantiPuoNascere`),
 * e per lo stesso motivo: la regola vive in una funzione che una prova può
 * ESEGUIRE, invece che in un commento dentro la rotta.
 *
 * ── La porta chiusa: due pagine di pagamento non si aprono mai ──────────────
 * Chiudere la pagina di Stripe vecchia è un'azione, e un'azione può fallire —
 * rete, chiamata rifiutata, oppure il caso peggiore: la pagina è appena stata
 * PAGATA e non si può più chiudere. Quelle sessioni tornano in
 * `ancoraPagabili`, e finché ce n'è anche una sola qui **non si va avanti**:
 * niente codice rivendicato, niente merce riservata, nessuna seconda pagina di
 * pagamento aperta sugli stessi articoli.
 *
 * Nel dubbio si sceglie di NON incassare: rifiutare costa al cliente trenta
 * secondi e un «riprova» (la riserva vecchia è ancora in piedi, quindi il
 * secondo tentativo riparte da capo), mentre due pagine vive sullo stesso
 * carrello costano un addebito doppio, un rimborso che si vede dopo giorni e
 * una telefonata all'assistenza. È la stessa scelta già fatta per i contanti.
 */

/** Il poco che serve del client di servizio: così la prova può eseguire davvero il claim. */
export type ClientRivendica = {
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message: string } | null }>;
};

/** Il client di sola lettura con cui si rilegge il coupon (la sessione del cliente). */
export type ClientLetturaCoupon = { from: (tabella: string) => any };

export type EsitoRivendicazione =
  | {
      ok: true;
      /** Il codice davvero rivendicato, in maiuscolo. `null` se non ne era stato chiesto nessuno. */
      codice: string | null;
      scontoCents: number;
      spedizioneGratis: boolean;
    }
  | {
      ok: false;
      /**
       * `pagamento_ancora_aperto` → 409: c'è una pagina di Stripe che non siamo
       * riusciti a rendere non pagabile. Gli altri due → 400.
       */
      motivo: 'pagamento_ancora_aperto' | 'codice_non_valido' | 'codice_non_disponibile';
      messaggio: string;
      /** Le sessioni rimaste pagabili, solo per il registro. */
      sessioni: string[];
    };

/**
 * Il cancello prima della cassa: si può rivendicare qualcosa, visto com'è
 * andata la pulizia dei tentativi abbandonati dello stesso cliente?
 *
 * Puro apposta — non parla né con Stripe né col database — così la regola si
 * esegue in una prova invece di raccontarla.
 */
export function laStradaELibera(riserve: RiserveLiberate | null | undefined): {
  libera: boolean;
  sessioni: string[];
} {
  const sessioni = [
    ...new Set(
      (riserve?.ancoraPagabili ?? []).filter((s): s is string => typeof s === 'string' && s.trim() !== ''),
    ),
  ];
  return { libera: sessioni.length === 0, sessioni };
}

/**
 * Rivalida il codice sconto dalla fonte autorevole e lo rivendica in modo
 * atomico (`claim_coupon`), ma **solo dopo** che i tentativi abbandonati dello
 * stesso cliente sono stati liberati.
 *
 * @param riserveLiberate  Il resoconto di `liberaRiserveAbbandonate`. È il primo
 *   parametro apposta: è la prova che la pulizia è già passata. Senza, questa
 *   funzione non si può chiamare.
 */
export async function rivendicaIlCodiceSconto(
  riserveLiberate: RiserveLiberate,
  clienti: { admin: ClientRivendica; lettura: ClientLetturaCoupon },
  richiesta: { codice?: string | null; subtotaleCents: number; userId: string | null },
): Promise<EsitoRivendicazione> {
  // ① Una pagina di pagamento rimasta viva ferma tutto, codice o non codice.
  const strada = laStradaELibera(riserveLiberate);
  if (!strada.libera) {
    return {
      ok: false,
      motivo: 'pagamento_ancora_aperto',
      messaggio: MOTIVO_CARTA_ANCORA_APERTA,
      sessioni: strada.sessioni,
    };
  }

  const codice = richiesta.codice?.trim();
  if (!codice) return { ok: true, codice: null, scontoCents: 0, spedizioneGratis: false };

  // ② Rilettura dal database: lo sconto non si accetta mai dal browser. E qui
  //    il contatore degli usi è già quello ripulito dal passo ①.
  const esito = await validateCoupon(
    codice,
    richiesta.subtotaleCents / 100,
    richiesta.userId,
    clienti.lettura,
  );
  if (!esito.ok) {
    return {
      ok: false,
      motivo: 'codice_non_valido',
      messaggio: `Coupon non valido: ${esito.reason}`,
      sessioni: [],
    };
  }

  // ③ Rivendicazione atomica (fix #36): due richieste in parallelo non possono
  //    consumare lo stesso uso. Chi perde la corsa legge un messaggio chiaro.
  const { data: preso, error } = await clienti.admin.rpc('claim_coupon', { p_code: esito.coupon.code });
  if (error || !preso) {
    return {
      ok: false,
      motivo: 'codice_non_disponibile',
      messaggio: 'Coupon non disponibile: potrebbe essere esaurito nel frattempo.',
      sessioni: [],
    };
  }

  return {
    ok: true,
    codice: esito.coupon.code,
    // Lo sconto arriva in euro con i decimali: si arrotonda al centesimo e non
    // può mai essere negativo.
    scontoCents: Math.max(0, Math.round(esito.discount * 100)),
    spedizioneGratis: esito.freeShipping,
  };
}
