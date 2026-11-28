import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';
import { annullaERimborsa, avvisaIlNegozioDellAnnullo, COLONNE_ANNULLO, type OrdineDaAnnullare } from '@/lib/ordini/annulla';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { scriviCampanella } from '@/lib/ordini/campanella';
import { logger } from '@/lib/logger';

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
    .select(`${COLONNE_ANNULLO}, rider_id`)
    .eq('id', params.id)
    .single();
  // 20/11/2026 (R04-002) — Un guasto del database non è «non trovato»: 500 «riprova». «Non c'è»
  // restano PGRST116 («nessuna riga») e 22P02 (un id che non è un UUID: nessuna riga può averlo).
  if (error && error.code !== 'PGRST116' && error.code !== '22P02') {
    logger.error('[admin-cancel] lettura ordine fallita', { orderId: params.id, code: error.code, message: error.message });
    return ApiErrors.internal('Non riesco a leggere l’ordine adesso: riprova fra poco.');
  }
  if (!riga) return ApiErrors.notFound('Ordine non trovato');
  const order = riga as unknown as OrdineDaAnnullare & { rider_id?: string | null };
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');
  // 5/11/2026 (S05) — Un ordine in contanti già consegnato non si annulla, anche
  // se l'incasso non risulta confermato: la merce l'ha il cliente e non torna a
  // scaffale, e i contanti vanno chiesti al fattorino. Si gestisce con un reclamo.
  // (Su un ordine con carta consegnato l'annullo resta la strada del rimborso.)
  // 27/11/2026 — Il reclamo lo apre solo il cliente dell'ordine (app/api/disputes/route.ts): chi
  // amministra lo chiude in Reclami col rimborso. «Apri un reclamo» era un passo che non può fare.
  if (order.delivery_status === 'DELIVERED' && order.payment_method === 'cod') {
    return ApiErrors.conflict(
      'Ordine in contanti già consegnato: non si annulla. Chiedi i contanti al fattorino; ' +
      'per rimborsare il cliente, fagli aprire un reclamo dalla pagina dell’ordine e chiudilo in Reclami.',
    );
  }

  // 5/11/2026 (S05) — La nota scritta dall'amministratore resta nel registro, non
  // arriva al cliente: prima finiva parola per parola nell'email del rimborso.
  const reason = 'Ordine annullato dall’amministrazione';
  const notaInterna = body.reason?.trim() || null;

  // La logica del denaro sta in un posto solo (lib/ordini/annulla.ts), perché
  // era una copia unica dentro questa rotta e il percorso del cliente non
  // l'attraversava mai: chi annullava dal sito non veniva rimborsato.
  // R31-022 — Ordine già ritirato dal fattorino o consegnato: la merce non è in negozio, e
  // l'annullo non la rimette in vendita (un pezzo fantasma lo scopre un cliente che ha già pagato).
  const merceUscita = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(String(order.delivery_status));
  const esito = await annullaERimborsa(admin, order, {
    reason,
    metadata: { canceled_by: user.id, source: 'admin_cancel' },
    motivoCredito: 'order_admin_canceled',
    ...(merceUscita ? { merceNonTorna: true } : {}),
  });

  if (!esito.ok) {
    if (esito.motivo === 'CONTANTI_INCASSATI') {
      // 5/11/2026 (S05) — Niente parentesi (friendlyError le toglie) e niente passi
      // che non esistono: la strada vera è il reclamo, col bonifico fatto a mano.
      // 27/11/2026 — Il reclamo lo apre il cliente, non chi amministra (app/api/disputes/route.ts):
      // chiuso in Reclami col rimborso, il bonifico da fare a mano compare in Bonifici di rimborso.
      return ApiErrors.conflict(
        'Ordine già incassato in contanti dal fattorino: dal pannello non si annulla. ' +
        'Per restituire i soldi, fai aprire al cliente un reclamo dalla pagina dell’ordine e chiudilo in Reclami col rimborso.',
      );
    }
    // 27/8/2026 (R131) — Il secondo annullo sovrapposto non trova righe da
    // prendere: e' gia' annullato, e i soldi non si toccano una seconda volta.
    if (esito.motivo === 'GIA_ANNULLATO') return ApiErrors.conflict('Ordine già annullato');
    if (esito.motivo === 'STRIPE_NON_CONFIGURATO') return ApiErrors.unavailable('Stripe non configurato');
    if (esito.motivo === 'RIMBORSO_FALLITO') {
      return ApiErrors.badGateway('Rimborso Stripe fallito: ' + (esito.dettaglio ?? 'unknown'));
    }
    // 16/10/2026 — Quanto rendere si sa solo dopo aver diviso il rimborso dal cruscotto.
    // Sotto i 200 caratteri, una riga, senza parentesi: più lunga, la pagina Ordini la
    // sostituiva con «Qualcosa non ha funzionato» (friendlyError, lib/errors.ts) e chi
    // annullava riprovava a vuoto senza sapere perché.
    if (esito.motivo === 'RIMBORSO_DA_DIVIDERE') {
      return ApiErrors.conflict(
        "Su questo pagamento c'è un rimborso dal cruscotto non ancora diviso fra i negozi. " +
          'Dividilo nel riquadro «Rimborsi dal cruscotto da dividere» qui in Ordini, poi annulla di nuovo.',
      );
    }
    // Un 500 senza riga nel registro non lo vede nessuno: il guasto resta solo nella risposta.
    logger.error('[admin-cancel] annullo ordine fallito', {
      orderId: order.id,
      motivo: esito.motivo,
      dettaglio: esito.dettaglio,
      adminId: user.id,
    });
    return ApiErrors.internal('Annullamento fallito');
  }
  const refundId = esito.refundId;

  // Notifica in-app al buyer.
  await scriviCampanella(admin, {
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
    user_id: order.user_id,
    title: 'Ordine annullato',
    body: refundId ? `${reason} · rimborso emesso` : reason,
    link: `/orders/${order.id}`,
  }, { dove: 'admin-cancel', ordine: order.id });

  // 5/11/2026 (S05) — Anche negozio e fattorino assegnato devono saperlo: prima
  // l'avviso partiva solo al cliente, e il fattorino poteva andare a vuoto.
  const numero = `#${String(order.id).slice(0, 6).toUpperCase()}`;
  const altri = [
    order.seller_id ? { user_id: order.seller_id, link: `/seller/orders/${order.id}` } : null,
    order.rider_id ? { user_id: order.rider_id, link: `/rider/orders/${order.id}` } : null,
  ].filter((x): x is { user_id: string; link: string } => x !== null);
  const fraseAgliAltri = order.delivery_status === 'DELIVERED'
    ? 'L’amministrazione ha annullato l’ordine già consegnato e ha rimborsato il cliente.'
    : 'L’amministrazione ha annullato l’ordine: non va più preparato né consegnato.';
  for (const a of altri) {
    // 5/11/2026 (unione) — Dalla stessa porta delle altre campanelle (S02): se la scrittura cade, lo dice.
    await scriviCampanella(admin, {
      category: 'order',
      user_id: a.user_id,
      title: `Ordine ${numero} annullato`,
      body: fraseAgliAltri,
      link: a.link,
    }, { dove: 'admin/cancel (negozio e fattorino)', ordine: order.id });
  }
  // R31-023 — Al negozio anche l'email, come per il «Nuovo ordine». Non lancia: l'annullo è già scritto.
  await avvisaIlNegozioDellAnnullo(admin, order, fraseAgliAltri);

  await writeAudit({
    actorId: user.id,
    action: 'order.force_cancel',
    targetTable: 'orders',
    targetId: order.id,
    metadata: { reason, nota: notaInterna, refundId, paymentMethod: order.payment_method, totalPrice: order.total_price },
  });

  return NextResponse.json({ ok: true, refundId }, { status: 200 });
}

// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
const postSenzaFila = withAdminAuth(({ req, user, params }) => handler(req, user, { id: String(params.id) }));

// 28/11/2026 (onda 2, R09-006 + R06-012) — Gli avvisi dell'annullo passano dalla fila della richiesta:
// la rotta si avvolge, così le email partono una alla volta e non tutte insieme.
export const POST = conFilaPerRichiesta(postSenzaFila);
