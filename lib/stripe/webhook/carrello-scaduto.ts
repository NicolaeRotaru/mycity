/**
 * Il carrello abbandonato sulla pagina di pagamento (`checkout.session.expired`).
 *
 * 15/10/2026 — Spostato qui da `ordini.ts`, che era a una riga dal tetto delle
 * 600 (prova `webhook-diviso-per-mestiere`): la riparazione di R81 ci doveva
 * aggiungere righe. La logica di prima è la stessa; cambia solo che la merce
 * non rimessa in vendita adesso si vede (vedi sotto).
 */
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';
import type { PendingGroup } from './ordini';

/**
 * checkout.session.expired → il buyer ha abbandonato il pagamento. Rilascia lo stock
 * riservato al checkout (immediato, senza attendere il cron expire-checkouts).
 */
export async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const pid = session.client_reference_id ?? session.metadata?.pending_checkout_id;
  if (!pid) return;
  // 162 — PRIMA DI RIMETTERE A SCAFFALE, GUARDA SE E' GIA' STATO VENDUTO: col pagamento riuscito e
  // il webhook morto a meta' gli ordini esistono gia', e ripristinare qui vuol dire rivendere pezzi
  // gia' usciti. Il giro periodico questa guardia ce l'ha — e avvisa gli amministratori; qui no.
  const { data: giaNati, error: errOrdini } = await admin.from('orders').select('id').eq('stripe_session_id', session.id).limit(1);
  if (errOrdini) throw new Error(`[stripe] carrello scaduto: controllo ordini fallito (${errOrdini.message})`);
  if (giaNati?.length) {
    logger.error('[stripe] carrello scaduto con ordini gia creati: merce NON rimessa in vendita', { pid });
    return;
  }
  // 064 — Prima si leggeva, si rilasciava la merce e POI si scriveva EXPIRED:
  // il cron `expire-checkouts` e questo evento potevano passare insieme e
  // rimettere in magazzino la stessa merce due volte, e restituire due volte il
  // codice sconto. La rivendicazione condizionata è la stessa forma già usata
  // nel cron: o la riga passa da PENDING a EXPIRED qui, o non si fa niente.
  const { data: rivendicati } = scritturaObbligatoria(await admin
    .from('pending_checkouts')
    .update({ status: 'EXPIRED' })
    .eq('id', pid)
    .eq('status', 'PENDING')
    .select('id, groups, coupon_code'), 'carrello scaduto');
  const pending = rivendicati?.[0];
  if (!pending) return;
  const groups = (pending.groups as PendingGroup[]) ?? [];
  const items = groups.flatMap((g) =>
    (g.items ?? []).map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
  );
  if (items.length > 0) {
    /**
     * 15/10/2026 (R81) — LA MERCE CHE NON TORNA IN VENDITA SI DEVE VEDERE.
     *
     * L'esito di questa chiamata non lo leggeva nessuno. Se il database la
     * rifiutava, la merce restava tolta dalla vendita per sempre: il carrello
     * qui sopra è già 'EXPIRED', e né questo avviso ripetuto né il giro
     * periodico lo riprendono più. Far riprovare Stripe non servirebbe (al
     * secondo passaggio la rivendicazione non passa): si dice agli
     * amministratori quale carrello sistemare a mano.
     */
    const { error: errScaffale } = await admin.rpc('restore_stock', { p_items: items });
    if (errScaffale) {
      logger.error('[stripe] carrello scaduto: merce non rimessa in vendita', { pid, message: errScaffale.message });
      await notifyAdmins(
        '⚠️ Merce non rimessa in vendita',
        `Il carrello ${pid} è scaduto ma la sua merce (${items.length} articolo/i) non è tornata in vendita: la giacenza va sistemata a mano.`,
        '/admin/orders',
      );
    }
  }

  // Il codice sconto torna disponibile: il cliente ha abbandonato il pagamento.
  const codiceAbbandonato = (pending as { coupon_code?: string | null }).coupon_code ?? null;
  if (codiceAbbandonato) {
    const { error: cErr } = await admin.rpc('release_coupon', { p_code: codiceAbbandonato });
    if (cErr) logger.warn('[stripe] codice sconto non restituito', { pid, message: cErr.message });
  }
}
