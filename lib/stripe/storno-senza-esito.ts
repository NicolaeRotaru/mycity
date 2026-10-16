/**
 * Il segno «storno da fare» sugli ordini, e l'avviso quando resta senza esito.
 *
 * 16/10/2026 (settimo riesame del lotto) — LO STORNO RIMASTO A METÀ NON È PIÙ MUTO.
 *
 * `registraSullOrdine` fa due passi: scrive il rimborso sull'ordine, poi chiede
 * a Stripe lo storno della quota del negozio. Se il processo moriva in mezzo
 * (per esempio per il tetto di durata della funzione, con Stripe lento), chi
 * arrivava dopo trovava il rimborso già scritto e lo saltava: lo storno non si
 * rifaceva, non si scriveva niente, e il negozio teneva la sua quota senza che
 * nessuno lo sapesse.
 *
 * Adesso la stessa scrittura che registra il rimborso porta un segno, «storno da
 * fare, esito non ancora registrato» (`reversal_error`), che si toglie solo
 * dopo che Stripe ha risposto. Se lo storno fallisce, il segno diventa
 * 'REVERSAL_FAILED' col motivo, come prima. Se il processo muore, il segno
 * resta: il primo che torna su quell'ordine — Stripe che ripete l'avviso, o la
 * divisione dal pannello ripresa — lo trova e avvisa gli amministratori, una
 * volta sola. Non si ritenta lo storno da soli: la risposta di Stripe può
 * essersi persa con lo storno fatto davvero.
 */
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

const SEGNO_DELLO_STORNO = /^Storno di (\d+) centesimi per il rimborso dal cruscotto .*: esito non ancora registrato$/;

/** Il segno che si scrive sull'ordine insieme al rimborso, quando la quota va ripresa con uno storno. */
export function segnoDelloStornoDaFare(centesimi: number, rimborsi: ReadonlyArray<string>): string {
  return `Storno di ${centesimi} centesimi per il rimborso dal cruscotto ${rimborsi.join(',') || '-'}: esito non ancora registrato`;
}

/** I centesimi dello storno chiesto e mai confermato, se l'ordine porta il segno; se no `null`. */
export function stornoNonConfermato(reversalError: string | null | undefined): number | null {
  const trovato = SEGNO_DELLO_STORNO.exec(reversalError ?? '');
  return trovato ? Number(trovato[1]) : null;
}

/**
 * Avvisa gli amministratori degli ordini che portano ancora il segno di uno
 * storno mai confermato. Una volta sola per segno. Il testo vale sia se il
 * lavoro è morto sia se è ancora in corso: dice cosa guardare su Stripe.
 */
export async function avvisaDegliStorniNonConfermati(
  ordini: ReadonlyArray<{ id: string; reversal_error?: string | null }>,
): Promise<void> {
  for (const ordine of ordini) {
    const centesimi = stornoNonConfermato(ordine.reversal_error);
    if (centesimi === null) continue;
    logger.error('[stripe] storno al negozio chiesto e mai confermato', { orderId: ordine.id, centesimi });
    await notifyAdmins(
      '⚠️ Storno al negozio da controllare',
      `Sull'ordine ${ordine.id} è registrato un rimborso dal cruscotto Stripe, e al negozio vanno ripresi ` +
        `${formatPriceFromCents(centesimi)} con uno storno, ma l'esito dello storno non risulta registrato: il lavoro che lo ` +
        "chiedeva può essersi fermato a metà. Guarda su Stripe (Connect → il bonifico dell'ordine → Storni): se lo storno " +
        "c'è, non va rifatto; se non c'è, va fatto a mano.",
      '/admin/orders',
      { unaVoltaPer: `storno-non-confermato:${ordine.id}:${ordine.reversal_error}` },
    );
  }
}

/**
 * Toglie il segno dopo che Stripe ha risposto allo storno. Solo quello scritto
 * da questo lavoro: se nel frattempo un altro l'ha cambiato (uno storno fallito
 * scrive il suo motivo), resta quello. Non lancia: lo storno è fatto, e un
 * segno rimasto al massimo fa arrivare un avviso da controllare.
 */
export async function togliIlSegnoDelloStorno(orderId: string, segno: string): Promise<void> {
  const { error } = await getAdminSupabase()
    .from('orders')
    .update({ reversal_error: null })
    .eq('id', orderId)
    .eq('reversal_error', segno);
  if (error) {
    logger.error('[stripe] storno fatto ma segno «da fare» non tolto: arriverà un avviso da controllare', {
      orderId, message: error.message,
    });
  }
}
