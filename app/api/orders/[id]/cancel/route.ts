import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

export const runtime = 'nodejs';

/**
 * IL CLIENTE ANNULLA, E I SOLDI TORNANO INDIETRO.
 *
 * Difetto bloccante della radiografia del 21/8/2026: il pulsante «Annulla
 * ordine» chiamava direttamente la funzione `cancel_order` del database, che
 * mette l'ordine in CANCELED e rimette la merce a magazzino. Del denaro non si
 * occupava nessuno.
 *
 * Il cliente pagava 24 €, annullava dieci minuti dopo perché aveva sbagliato
 * indirizzo, leggeva «Niente addebiti» — e sull'estratto conto i 24 € c'erano.
 * Nessun processo li restituiva: restavano finché qualcuno non se ne accorgeva.
 * Stessa cosa per il credito MyCity speso sull'ordine.
 *
 * Il rimborso non si può fare dal database: e' una chiamata a Stripe, e le
 * chiavi stanno sul server. Quindi l'annullamento passa da qui.
 *
 * LE REGOLE DI CHI PUÒ ANNULLARE RESTANO LE STESSE di `cancel_order`, ed è
 * apposta: l'ordine è tuo e il negozio non l'ha ancora accettato (stato NEW).
 * Cambiare anche quelle avrebbe voluto dire spostare due cose insieme.
 */
async function handler(_req: NextRequest, user: { id: string }, params: { id: string }) {
  const admin = getAdminSupabase();

  const { data, error } = await admin
    .from('orders')
    .select(COLONNE_ANNULLO)
    .eq('id', params.id)
    .maybeSingle();
  if (error) {
    logger.error('[cancel] lettura ordine fallita', { orderId: params.id, message: error.message });
    return ApiErrors.internal('Impossibile leggere l ordine');
  }
  if (!data) return ApiErrors.notFound('Ordine non trovato');

  const order = data as unknown as OrdineDaAnnullare;

  // Stesse regole della funzione del database, e nello stesso ordine.
  if (order.user_id !== user.id) return ApiErrors.notFound('Ordine non trovato');
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');
  if (order.delivery_status !== 'NEW') {
    return ApiErrors.conflict('Il negozio ha già accettato l ordine, non puoi più annullarlo.');
  }

  const esito = await annullaERimborsa(admin, order, {
    reason: 'Ordine annullato dal cliente',
    metadata: { canceled_by: user.id, source: 'buyer_cancel' },
    motivoCredito: 'order_canceled_by_buyer',
  });

  if (!esito.ok) {
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      return ApiErrors.conflict('Ordine già incassato in contanti: scrivi all assistenza per la restituzione.');
    }
    // 27/8/2026 (R131) — Chi arriva secondo (doppio invio, ritentativo di rete)
    // trova il turno gia' preso: si dice che e' fatto, non si accredita di nuovo.
    if (esito.motivo === 'GIA_ANNULLATO') return ApiErrors.conflict('Ordine già annullato');
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Rimborsi non disponibili, riprova più tardi');
    if (esito.motivo === 'RIMBORSO_FALLITO') return ApiErrors.badGateway('Rimborso fallito: ' + (esito.dettaglio ?? 'riprova'));
    return ApiErrors.internal('Annullamento fallito');
  }

  await admin.from('notifications').insert([
    {
      category: 'order',
      user_id: order.user_id,
      title: '✕ Ordine annullato',
      body: esito.refundId ? 'Ordine annullato · rimborso emesso' : 'Ordine annullato',
      link: `/orders/${order.id}`,
    },
    ...(order.seller_id
      ? [{
          category: 'order',
          user_id: order.seller_id,
          title: '❌ Ordine annullato dal cliente',
          body: `Il cliente ha annullato l'ordine #${order.id.slice(0, 6)}.`,
          link: `/seller/orders/${order.id}`,
        }]
      : []),
  ]);

  return NextResponse.json({ ok: true, refundId: esito.refundId }, { status: 200 });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAuthRateLimit({ name: 'order-cancel', max: 10, windowMs: 60_000 }, async ({ user }) => handler(req, user, await ctx.params))(req);
