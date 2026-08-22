import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

const Body = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Admin annulla un ordine.
 *  - Ordine carta GIÀ PAGATO → rimborso Stripe REALE + claw-back del transfer
 *    (refundOrder, che imposta anche delivery_status='CANCELED').
 *  - Ordine COD / non pagato → solo CANCELED (niente Stripe).
 * Rifiuta ordini già CANCELED. Notifica il buyer in campanella.
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON).catch(() => ({})));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const admin = getAdminSupabase();
  const { data: riga, error } = await admin
    .from('orders')
    .select(COLONNE_ANNULLO)
    .eq('id', params.id)
    .single();
  if (error || !riga) return ApiErrors.notFound('Ordine non trovato');
  const order = riga as unknown as OrdineDaAnnullare;
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');

  const reason = body.reason?.trim() || 'Ordine annullato dall’amministrazione';

  // La logica del denaro sta in un posto solo (lib/ordini/annulla.ts), perché
  // era una copia unica dentro questa rotta e il percorso del cliente non
  // l'attraversava mai: chi annullava dal sito non veniva rimborsato.
  const esito = await annullaERimborsa(admin, order, {
    reason,
    metadata: { canceled_by: user.id, source: 'admin_cancel' },
    motivoCredito: 'order_admin_canceled',
  });

  if (!esito.ok) {
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      return ApiErrors.conflict(
        'Ordine già incassato in contanti dal fattorino: la restituzione va gestita a mano ' +
        '(rimborso al cliente o nota di credito). Registra la scelta prima di annullare.',
      );
    }
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Stripe non configurato');
    if (esito.motivo === 'RIMBORSO_FALLITO') {
      return ApiErrors.badGateway('Rimborso Stripe fallito: ' + (esito.dettaglio ?? 'unknown'));
    }
    return ApiErrors.internal('Annullamento fallito');
  }
  const refundId = esito.refundId;

  // Notifica in-app al buyer.
  await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
    user_id: order.user_id,
    title: '✕ Ordine annullato',
    body: refundId ? `${reason} · rimborso emesso` : reason,
    link: `/orders/${order.id}`,
  });

  await writeAudit({
    actorId: user.id,
    action: 'order.force_cancel',
    targetTable: 'orders',
    targetId: order.id,
    metadata: { reason, refundId, paymentMethod: order.payment_method, totalPrice: order.total_price },
  });

  return NextResponse.json({ ok: true, refundId }, { status: 200 });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuth(async ({ user }) => handler(req, user, await ctx.params))(req);
