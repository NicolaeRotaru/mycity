import { logger } from '@/lib/logger';

/**
 * #208 — L'ACQUISTO VENIVA CONTATO SOLO SE IL CLIENTE TORNAVA SULLA PAGINA
 * ORDINI.
 *
 * `order_placed` partiva unicamente dal browser: dal checkout in contanti e
 * dal rientro su /orders?stripe=success. Tre modi di perderlo, tutti normali:
 *  ① il cliente chiude la scheda dopo aver pagato — l'ordine esiste nel
 *    database e non esiste in PostHog;
 *  ② il valore veniva letto da `sessionStorage`, che è vuoto se il pagamento
 *    si conclude in un browser dentro un'app o in una scheda diversa;
 *  ③ il segno «già contato» si scriveva prima che la lettura dell'ordine
 *    finisse: una ricarica in quel mezzo secondo perdeva l'evento e lo
 *    marcava come mandato.
 *
 * Risultato: il numero di acquisti era più basso di quello vero di una
 * quantità che nessuno conosce, e non riconciliava con la tabella `orders`.
 * Ogni tasso di conversione e ogni ritorno di campagna poggiava su un
 * fatturato sotto-contato — e diventa un bloccante il giorno in cui parte
 * spesa pubblicitaria vera, perché si deciderebbe il budget su un numero
 * falso.
 *
 * Qui l'evento parte dal server, dove il fatto è certo: l'ordine è appena
 * stato scritto. Nessuna libreria nuova — PostHog accetta una POST semplice
 * sul suo endpoint di raccolta — e `$insert_id` costruito sull'id dell'ordine
 * rende innocuo il doppio invio: se lo manda anche il browser, PostHog ne
 * conta uno solo.
 *
 * Best-effort per costruzione: una misura non deve mai far fallire un ordine.
 */

const CHIAVE = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export type AcquistoDaContare = {
  orderId: string;
  buyerId: string;
  totalCents: number;
  paymentMethod: 'card' | 'cod';
  sellerId: string;
  /** Tiene insieme gli ordini nati dallo stesso carrello. */
  checkoutId?: string | null;
  /**
   * Ha detto sì all'analitica? Obbligatorio, e non ha valore di scorta: chi
   * chiama deve dichiararlo, così dimenticarselo diventa un errore di
   * compilazione invece di un dato che parte in silenzio.
   */
  consensoAnalytics: boolean;
};

/** L'evento è configurato? Serve a non riempire i log quando PostHog non c'è. */
export function misuraAttiva(): boolean {
  return !!CHIAVE;
}

/**
 * IL CONSENSO ALL'ANALITICA, LETTO DAL SERVER (21/8/2026).
 *
 * Il browser il consenso lo rispettava; il server no. Su ogni ordine — carta e
 * contanti — partiva verso gli Stati Uniti un dato d'acquisto legato
 * all'identificativo della persona, anche da chi aveva risposto NO al banner.
 * È la contraddizione più facile da dimostrare che avessimo: due pagine
 * pubbliche promettono che quel no viene rispettato.
 *
 * Si legge dal registro dei consensi, che è la prova che teniamo apposta. Se
 * per quella persona non c'è nessuna riga, la risposta è NO: un consenso che
 * non risulta non è un consenso dato. Vale anche quando il registro è
 * illeggibile — meglio perdere una misura che mandare un dato che non potevamo
 * mandare.
 */
export async function analyticsConsentita(
  admin: { from: (t: string) => any },
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await admin
      .from('consent_log')
      .select('valore')
      .eq('user_id', userId)
      .eq('categoria', 'analytics')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn('[analytics] consenso non leggibile: non conto', { userId, message: error.message });
      return false;
    }
    return (data as { valore?: boolean } | null)?.valore === true;
  } catch (e) {
    logger.warn('[analytics] consenso non leggibile: non conto', { userId, e });
    return false;
  }
}

export async function contaAcquisto(a: AcquistoDaContare): Promise<void> {
  if (!CHIAVE) return;
  // Il cancello sta qui, non nei chiamanti: un chiamante nuovo che se lo
  // dimentica non deve poter far partire il dato lo stesso.
  if (a.consensoAnalytics !== true) return;
  try {
    const risposta = await fetch(`${HOST.replace(/\/$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: CHIAVE,
        event: 'order_placed',
        distinct_id: a.buyerId,
        properties: {
          order_id: a.orderId,
          total_cents: a.totalCents,
          payment_method: a.paymentMethod,
          seller_id: a.sellerId,
          checkout_id: a.checkoutId ?? a.orderId,
          // 21/8/2026 — Questo commento diceva il falso, e il falso costava il
          // doppio. `$insert_id` toglie i doppioni solo a parità di istante:
          // browser e server mandano lo stesso evento in due momenti diversi,
          // quindi PostHog li contava tutti e due. Fatturato e numero di
          // acquisti risultavano doppi, e ogni tasso di conversione poggiava su
          // quel numero. Adesso l'evento parte SOLO da qui: il browser non lo
          // manda più, perché il server è il posto dove il fatto è certo — chi
          // chiude la scheda dopo aver pagato ha comunque un ordine.
          // La chiave resta, e serve ancora: protegge dal ritentativo del server.
          $insert_id: `order_placed:${a.orderId}`,
          // Da dove arriva: serve a capire quanto pesava il buco del browser.
          origine: 'server',
        },
      }),
      // La misura non tiene in ostaggio la risposta a Stripe: se PostHog è
      // lento si molla, l'ordine è già fatto.
      signal: AbortSignal.timeout(3000),
    });
    if (!risposta.ok) {
      logger.warn('[analytics] acquisto non registrato', { orderId: a.orderId, stato: risposta.status });
    }
  } catch (e) {
    logger.warn('[analytics] acquisto non registrato', { orderId: a.orderId, e });
  }
}
