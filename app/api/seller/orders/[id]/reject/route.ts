import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * IL NEGOZIO RIFIUTA, E I SOLDI TORNANO AL CLIENTE.
 *
 * Difetto bloccante della radiografia del 27/8/2026. Il pulsante «Rifiuta» del
 * negoziante chiamava direttamente `seller_reject_order` del database, che fa
 * tre cose: ordine in CANCELED, merce a magazzino, credito e codice sconto
 * restituiti. Del denaro sulla carta non si occupava nessuno — dal database non
 * si può: le chiavi di Stripe stanno sul server.
 *
 * Al cliente arrivava intanto un messaggio che diceva, testualmente, «Niente
 * addebiti». L'addebito restava dov'era, per sempre. Ed è il caso più normale
 * del primo mese: prodotto finito, negoziante di fretta. Chi paga, non riceve
 * la merce e non rivede i soldi va alla sua banca: è la contestazione carta,
 * che costa la commissione più la reputazione del conto Stripe.
 *
 * La strada giusta esisteva già ed era percorsa dall'annullamento del cliente e
 * da quello dell'amministrazione: `annullaERimborsa`. Il rifiuto del negozio è
 * la terza porta sulla stessa strada.
 *
 * LE REGOLE DI CHI PUÒ RIFIUTARE RESTANO QUELLE DI `seller_reject_order`:
 * l'ordine è del mio negozio, e non è ancora partito (NEW o ACCEPTED).
 *
 * LA PROVA: tests/unit/il-rifiuto-del-negozio-restituisce-i-soldi.test.ts.
 */
const STATI_RIFIUTABILI = ['NEW', 'ACCEPTED'];

type OrdineDaRifiutare = OrdineDaAnnullare & { coupon_code?: string | null; rider_id?: string | null };

async function handler(req: NextRequest, user: { id: string }, params: { id: string }) {
  const admin = getAdminSupabase();

  let motivo: string | null = null;
  try {
    const body = (await jsonRichiesta(req, TETTO_JSON)) as { reason?: unknown };
    if (typeof body?.reason === 'string' && body.reason.trim()) motivo = body.reason.trim().slice(0, 300);
  } catch {
    // Il motivo è facoltativo: un corpo assente o illeggibile non è un errore.
  }

  const { data, error } = await admin
    .from('orders')
    .select(`${COLONNE_ANNULLO}, coupon_code, rider_id`)
    .eq('id', params.id)
    .maybeSingle();
  if (error) {
    logger.error('[seller-reject] lettura ordine fallita', { orderId: params.id, message: error.message });
    return ApiErrors.internal('Impossibile leggere l ordine');
  }
  if (!data) return ApiErrors.notFound('Ordine non trovato');

  const order = data as unknown as OrdineDaRifiutare;

  // Stesse regole della funzione del database, e nello stesso ordine.
  if (order.seller_id !== user.id) return ApiErrors.notFound('Ordine non trovato');
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');
  if (!STATI_RIFIUTABILI.includes(order.delivery_status ?? '')) {
    return ApiErrors.conflict('L ordine è già in consegna: non puoi più rifiutarlo.');
  }

  const esito = await annullaERimborsa(admin, order, {
    reason: motivo ? `Rifiutato dal negozio: ${motivo}` : 'Ordine rifiutato dal negozio',
    metadata: { rejected_by: user.id, source: 'seller_reject' },
    motivoCredito: 'order_rejected_by_seller',
  });

  if (!esito.ok) {
    // Il rifiuto NON passa se i soldi non tornano: un ordine annullato con
    // l'addebito ancora in piedi è il difetto che stiamo chiudendo.
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      return ApiErrors.conflict('Ordine già incassato in contanti: scrivi all assistenza per la restituzione.');
    }
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Rimborsi non disponibili, riprova più tardi');
    if (esito.motivo === 'RIMBORSO_FALLITO') return ApiErrors.badGateway('Rimborso fallito: ' + (esito.dettaglio ?? 'riprova'));
    return ApiErrors.internal('Rifiuto fallito');
  }

  // Il codice sconto torna utilizzabile a chi non ha comprato niente: lo faceva
  // la funzione del database, e deve continuare a farlo anche di qui.
  if (order.coupon_code && order.coupon_code.trim()) {
    const { error: cErr } = await admin.rpc('release_coupon', { p_code: order.coupon_code });
    if (cErr) logger.warn('[seller-reject] codice sconto non liberato', { orderId: order.id, message: cErr.message });
  }

  const creditoCents = Number(order.wallet_applied_cents ?? 0);
  const pezzi = [
    motivo ? `Motivo: ${motivo}` : 'Il negozio non può completare il tuo ordine.',
    esito.refundId ? 'Il pagamento è stato rimborsato sulla tua carta.' : 'Nessun addebito è andato a buon fine.',
    creditoCents > 0 ? `Il credito MyCity che avevi usato (€${(creditoCents / 100).toFixed(2)}) è tornato sul tuo saldo.` : '',
    order.coupon_code ? `Il codice sconto ${order.coupon_code} torna utilizzabile.` : '',
  ].filter(Boolean);

  const { error: nErr } = await admin.from('notifications').insert([
    {
      category: 'order',
      user_id: order.user_id,
      title: '❌ Ordine rifiutato dal negozio',
      body: pezzi.join(' '),
      link: `/orders/${order.id}`,
    },
    ...(order.rider_id
      ? [{
          category: 'order',
          user_id: order.rider_id,
          title: '❌ Ordine annullato',
          body: `L'ordine #${order.id.slice(0, 6)} è stato annullato.`,
          link: '/rider',
        }]
      : []),
  ]);
  if (nErr) logger.warn('[seller-reject] avviso al cliente non scritto', { orderId: order.id, message: nErr.message });

  return NextResponse.json({ ok: true, refundId: esito.refundId }, { status: 200 });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAuthRateLimit({ name: 'seller-order-reject', max: 20, windowMs: 60_000 }, async ({ user }) =>
    handler(req, user, await ctx.params),
  )(req);
