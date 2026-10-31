import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { annullaERimborsa, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

export const runtime = 'nodejs';

/**
 * 31/10/2026 — IL FATTORINO PUÒ DIRE «CLIENTE ASSENTE».
 *
 * Fino a oggi, da «in consegna» il fattorino aveva una strada sola: il codice
 * del cliente, che porta a «consegnato». Se alla porta non rispondeva nessuno
 * l'ordine restava «in consegna» per sempre, e la merce col fattorino.
 *
 * Scelta di Nicola del 31/10 (fatto `consegna.cliente-assente`): niente stato
 * nuovo e niente trattenute. Dopo aver provato a telefonare, il fattorino segna
 * «cliente assente» e l'ordine si annulla come ogni altro annullo, con
 * `annullaERimborsa`: con la carta torna tutto, coi contanti non si paga
 * niente, la merce torna a magazzino del negozio.
 *
 * Chi può: solo il fattorino assegnato all'ordine, e solo con l'ordine «in
 * consegna». Il doppio tocco non rende due volte: se l'ordine è già annullato
 * qui si risponde 409, e se due richieste arrivano insieme la scrittura di
 * `annullaERimborsa` lascia passare una sola delle due (GIA_ANNULLATO).
 */
const MOTIVO_CLIENTE_ASSENTE = 'cliente_assente';

const IdOrdine = z.string().uuid();

async function handler(user: { id: string }, idGrezzo: string): Promise<NextResponse> {
  const id = IdOrdine.safeParse(idGrezzo);
  if (!id.success) return ApiErrors.notFound('Ordine non trovato');

  // Client di servizio: il fattorino non ha il permesso di scrivere CANCELED, e
  // chi può toccare quale ordine lo decidono i controlli qui sotto.
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('orders')
    .select(`${COLONNE_ANNULLO}, rider_id`)
    .eq('id', id.data)
    .maybeSingle();
  if (error) {
    logger.error('[cliente-assente] lettura ordine fallita', { orderId: id.data, message: error.message });
    return ApiErrors.internal("Impossibile leggere l'ordine");
  }
  if (!data) return ApiErrors.notFound('Ordine non trovato');

  const order = data as unknown as OrdineDaAnnullare & { rider_id: string | null };
  if (order.rider_id !== user.id) return ApiErrors.forbidden('Non autorizzato (ordine di altro rider)');
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');
  if (order.delivery_status !== 'OUT_FOR_DELIVERY') {
    return ApiErrors.conflict('Puoi segnare «cliente assente» solo mentre l’ordine è in consegna.');
  }

  const esito = await annullaERimborsa(admin, order, {
    reason: 'Ordine annullato: cliente assente alla consegna',
    metadata: { canceled_by: user.id, source: MOTIVO_CLIENTE_ASSENTE },
    motivoCredito: 'order_canceled_cliente_assente',
  });

  if (!esito.ok) {
    if (esito.motivo === 'GIA_ANNULLATO') return ApiErrors.conflict('Ordine già annullato');
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      return ApiErrors.conflict("Hai già registrato l'incasso in contanti: scrivi all'assistenza per annullare.");
    }
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Rimborsi non disponibili, riprova più tardi');
    if (esito.motivo === 'RIMBORSO_FALLITO') return ApiErrors.badGateway("Il rimborso non è partito: riprova o scrivi all'assistenza.");
    if (esito.motivo === 'RIMBORSO_DA_DIVIDERE') {
      return ApiErrors.conflict("Su questo pagamento c'è un rimborso da sistemare: abbiamo avvisato l'assistenza, riprova più tardi.");
    }
    return ApiErrors.internal('Annullamento fallito');
  }

  const sigla = order.id.slice(0, 6).toUpperCase();
  const { error: nErr } = await admin.from('notifications').insert([
    {
      category: 'order',
      user_id: order.user_id,
      title: '✕ Ordine annullato: non eri in casa',
      body: esito.refundId
        ? `Il fattorino non ti ha trovato all'indirizzo dell'ordine #${sigla}. Ti abbiamo rimborsato tutto.`
        : `Il fattorino non ti ha trovato all'indirizzo dell'ordine #${sigla}. Non devi pagare niente.`,
      link: `/orders/${order.id}`,
    },
    ...(order.seller_id
      ? [{
          category: 'order',
          user_id: order.seller_id,
          title: '↩️ Ordine annullato: cliente assente',
          body: `Il cliente dell'ordine #${sigla} non era in casa: la merce torna in negozio.`,
          link: `/seller/orders/${order.id}`,
        }]
      : []),
  ]);
  if (nErr) logger.error('[cliente-assente] notifiche non scritte', { orderId: order.id, message: nErr.message });

  return NextResponse.json({ ok: true, motivo: MOTIVO_CLIENTE_ASSENTE, refundId: esito.refundId }, { status: 200 });
}

// Un fattorino ha poche consegne l'ora: 20 tocchi sono tanti anche con un telefono che ripete.
export const POST = withAuthRateLimit(
  { name: 'rider-cliente-assente', max: 20, windowMs: 60 * 60_000 },
  ({ user, params }) => handler(user, String(params.id)),
);
