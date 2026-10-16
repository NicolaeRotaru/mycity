/**
 * Il rimborso che la banca del cliente respinge: quanto torna indietro su
 * ciascun ordine, cosa si scrive, e come ci si ricorda di averlo già fatto.
 *
 * Sta in un file suo, senza database, perché è il conto che decide: il gestore
 * dell'avviso (`lib/stripe/webhook/rimborsi.ts`) legge gli ordini, chiede qui
 * il piano e scrive quello che il piano dice.
 *
 * 16/10/2026 (riesame del lotto) — LO STESSO AVVISO LAVORATO DUE VOLTE.
 *
 * Il gestore toglieva dall'ordine l'importo tornato indietro e rimetteva la
 * quota del negozio nel suo bonifico, senza lasciare nessun segno di averlo
 * fatto. Se l'avviso passava una seconda volta, rifaceva tutto sul valore già
 * ridotto. Un caso misurato sulla rotta vera: ordine da 40 € col bonifico al
 * negozio ancora trattenuto, due rimborsi parziali da 10 € (arrivato) e da 5 €
 * (respinto). Primo passaggio: rimborsato da 15 € a 10 €, giusto. Secondo
 * passaggio: a 5 €, come se il cliente i 10 € non li avesse avuti, e al
 * negozio la quota dei 5 € tornava una seconda volta nel bonifico (4,05 € in
 * più). Le strade per arrivarci sono rare ma vere: il segno «lavorato»
 * sull'avviso che non si scrive e Stripe che riconsegna dopo cinque minuti, il
 * processo che muore fra la scrittura e il segno, oppure un secondo
 * `charge.refund.updated` (un altro id di avviso) per lo stesso rimborso già
 * respinto — Stripe lo manda per esempio quando cambia l'etichetta.
 *
 * Adesso la stessa scrittura che toglie l'importo lascia nell'elenco dei
 * rimborsi dell'ordine (`stripe_refund_id`, lib/stripe/elenco-dei-rimborsi.ts)
 * un segno `respinto:<centesimi tolti>:<id del rimborso>`. Un ordine col segno
 * di questo rimborso non si tocca più. E la scrittura passa solo se l'ordine è
 * ancora quello letto: se due passaggi corrono insieme, il secondo non trova
 * la riga, lancia, Stripe riprova e alla rilettura trova il segno.
 *
 * Il segno porta anche QUANTO è stato tolto: se un pagamento ha più ordini e il
 * primo passaggio si ferma a metà, al passaggio dopo si divide fra quelli
 * rimasti solo quello che manca, non di nuovo tutto.
 */
import { elencoDaScrivere, rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';

/** I campi dell'ordine che servono a rimettere a posto un rimborso respinto. */
export type OrdineDelRimborsoRespinto = {
  id: string;
  refunded_amount_cents: number | null;
  payment_status: string | null;
  gross_total_cents?: number | null;
  total_price?: number | string | null;
  payout_status?: string | null;
  seller_payout_cents?: number | null;
  seller_payout_reversed_cents?: number | null;
  payout_tentativo?: number | null;
  /** L'elenco dei rimborsi scritti sull'ordine: qui sta anche il segno «respinto». */
  stripe_refund_id?: string | null;
};

/** Una scrittura sull'ordine, con le condizioni perché passi. */
export type ScritturaDelRimborsoRespinto = {
  ordineId: string;
  /** Quanto del rimborso respinto si toglie da questo ordine (centesimi). */
  quotaCents: number;
  valori: Record<string, unknown>;
  /**
   * La scrittura passa solo se l'ordine ha ancora questi valori, cioè quelli
   * letti: né un altro passaggio dello stesso avviso, né un altro rimborso, né
   * il giro dei bonifici l'hanno cambiato nel frattempo.
   */
  seAncora: {
    refunded_amount_cents: number | null;
    payout_status: string | null;
    stripe_refund_id: string | null;
  };
};

export type PianoDelRimborsoRespinto = {
  scritture: ScritturaDelRimborsoRespinto[];
  /** Gli ordini su cui questo rimborso respinto è già stato rimesso a posto. */
  giaFatti: string[];
};

const SEGNO = /^respinto:(\d+):(.+)$/;

/** Il segno che resta sull'ordine: «questo rimborso respinto l'ho già tolto, e quanto». */
export function segnoDelRimborsoRespinto(refundId: string, quotaCents: number): string {
  return `respinto:${Math.max(0, Math.round(quotaCents))}:${refundId}`;
}

/**
 * Quanto di questo rimborso respinto è già stato tolto dall'ordine, oppure
 * `null` se l'ordine non porta il suo segno. Senza id non si riconosce niente.
 */
export function quotaGiaTolta(
  ordine: Pick<OrdineDelRimborsoRespinto, 'stripe_refund_id'>,
  refundId: string,
): number | null {
  if (!refundId) return null;
  for (const segno of rimborsiGiaScritti(ordine)) {
    const trovato = SEGNO.exec(segno);
    if (trovato && trovato[2] === refundId) return Number(trovato[1]);
  }
  return null;
}

/**
 * Cosa scrivere su un ordine da cui si toglie `quota` di un rimborso respinto.
 * È la contabilità di sempre (R039 del 27/8, R85 del 15/10), più il segno.
 */
function valoriDellOrdine(ordine: OrdineDelRimborsoRespinto, quota: number, segno: string | null): Record<string, unknown> {
  const restante = Math.max(0, (ordine.refunded_amount_cents ?? 0) - quota);

  /**
   * 27/8/2026 (R039) — E IL NEGOZIO? RESTAVA STORNATO PER SEMPRE.
   *
   * Qui si rimetteva a posto solo la parte del cliente. Ma il rimborso, al
   * momento in cui era partito, aveva anche ripreso dal negozio la sua quota e
   * chiuso il suo bonifico ('REVERSED' se il bonifico era gia' uscito,
   * 'REFUNDED' se non era ancora partito). Il giro dei bonifici quegli stati
   * non li guarda — cerca 'HELD' e 'PENDING_SELLER_ONBOARDING' — quindi
   * quell'ordine non tornava mai piu' fra i candidati: la piattaforma coi soldi
   * rientrati, il cliente non rimborsato, il negozio non pagato.
   *
   * SI SOTTRAE, NON SI AZZERA: dentro `seller_payout_reversed_cents` puo'
   * esserci anche lo storno di un altro reso, che con questo rimborso non
   * c'entra. E' lo stesso ragionamento della contestazione vinta
   * (lib/stripe/webhook/dispute.ts).
   */
  const lordo = ordine.gross_total_cents ?? Math.round(Number(ordine.total_price ?? 0) * 100);
  const nettoNegozio = ordine.seller_payout_cents ?? 0;
  const quotaNegozio = lordo > 0 ? Math.min(Math.round((quota * nettoNegozio) / lordo), nettoNegozio) : 0;
  const bonificoChiusoDalRimborso = ordine.payout_status === 'REVERSED' || ordine.payout_status === 'REFUNDED';
  const bonificoEraGiaUscito = ordine.payout_status === 'REVERSED';
  /**
   * 15/10/2026 (R85, collaudo) — E SE IL BONIFICO NON ERA ANCORA PARTITO?
   *
   * Un rimborso PARZIALE su un ordine col bonifico ancora trattenuto toglie la
   * quota del negozio solo sulla carta: `seller_payout_reversed_cents` sale, il
   * bonifico resta 'HELD' e il giro verserà il resto. Se poi la banca del
   * cliente respinge il rimborso, qui si rimetteva a posto il cliente e non il
   * negozio. Un caso misurato: 3 € rimborsati dal cruscotto su un ordine col
   * netto del negozio di 18,00 €, rimborso respinto, e il giro versava 16,06 €
   * per un rimborso che il cliente non ha mai ricevuto. Adesso la quota torna
   * nel bonifico che deve ancora partire. Solo negli stati che il giro paga: se
   * il bonifico è in corso ('PROCESSING') l'importo è già deciso.
   */
  const bonificoAncoraDaFare = ordine.payout_status === 'HELD' || ordine.payout_status === 'PENDING_SELLER_ONBOARDING';
  const stornoRidotto = Math.max(0, (ordine.seller_payout_reversed_cents ?? 0) - quotaNegozio);

  return {
    refunded_amount_cents: restante,
    payment_status: restante > 0 ? 'PARTIALLY_REFUNDED' : 'PAID',
    ...(segno ? { stripe_refund_id: elencoDaScrivere(rimborsiGiaScritti(ordine), [segno]) } : {}),
    ...(bonificoChiusoDalRimborso
      ? {
          payout_status: 'HELD',
          seller_payout_reversed_cents: stornoRidotto,
          // Il bonifico precedente e' stato stornato: il prossimo deve essere
          // una richiesta NUOVA per Stripe, altrimenti con la stessa chiave di
          // idempotenza gli verrebbe restituito quello gia' annullato e il
          // negozio non incasserebbe niente.
          ...(bonificoEraGiaUscito
            ? {
                stripe_transfer_id: null,
                stripe_reversal_id: null,
                payout_at: null,
                payout_tentativo: (ordine.payout_tentativo ?? 0) + 1,
              }
            : {}),
        }
      : bonificoAncoraDaFare
        ? { seller_payout_reversed_cents: stornoRidotto }
        : {}),
  };
}

/**
 * Il piano per un rimborso respinto di `tornatoIndietroCents` sugli `ordini`
 * dello stesso pagamento (o sull'unico ordine indicato dall'etichetta).
 *
 * Gli ordini che portano già il segno di questo rimborso restano fuori, e
 * quello che hanno già tolto si scala dall'importo da dividere. Il resto si
 * divide in proporzione a quanto risultava rimborsato su ciascuno, senza
 * perdere centesimi: l'ultimo si prende il resto della divisione. Il tetto per
 * riga è quanto quella riga risultava rimborsata: non si toglie più di quello
 * che c'era scritto.
 */
export function pianoDelRimborsoRespinto(
  ordini: ReadonlyArray<OrdineDelRimborsoRespinto>,
  refundId: string,
  tornatoIndietroCents: number,
): PianoDelRimborsoRespinto {
  const giaFatti: string[] = [];
  let giaTolto = 0;
  const daFare: OrdineDelRimborsoRespinto[] = [];
  for (const o of ordini) {
    const tolta = quotaGiaTolta(o, refundId);
    if (tolta === null) {
      daFare.push(o);
    } else {
      giaFatti.push(o.id);
      giaTolto += tolta;
    }
  }

  const daDividere = Math.max(0, Math.max(0, tornatoIndietroCents) - giaTolto);
  const rimborsatoInTutto = daFare.reduce((somma, o) => somma + (o.refunded_amount_cents ?? 0), 0);
  let giaAssegnato = 0;
  const scritture = daFare.map((o, i): ScritturaDelRimborsoRespinto => {
    const suo = o.refunded_amount_cents ?? 0;
    const calcolata =
      i === daFare.length - 1
        ? daDividere - giaAssegnato
        : rimborsatoInTutto > 0
          ? Math.round((daDividere * suo) / rimborsatoInTutto)
          : Math.round(daDividere / daFare.length);
    giaAssegnato += calcolata;
    const quota = Math.min(Math.max(calcolata, 0), suo);
    return {
      ordineId: o.id,
      quotaCents: quota,
      valori: valoriDellOrdine(o, quota, refundId ? segnoDelRimborsoRespinto(refundId, quota) : null),
      seAncora: {
        refunded_amount_cents: o.refunded_amount_cents ?? null,
        payout_status: o.payout_status ?? null,
        stripe_refund_id: o.stripe_refund_id ?? null,
      },
    };
  });
  return { scritture, giaFatti };
}
