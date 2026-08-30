import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';

export const runtime = 'nodejs';

/**
 * UN RESO APPROVATO DEVE POTER ARRIVARE A FINE CORSA.
 *
 * 27/8/2026 (R042) — QUESTA ROTTA NON ESISTEVA, e il commento in cima a
 * `decide` la prometteva già: «transizione RECEIVED -> REFUNDED via altro
 * endpoint». Sotto `app/api/returns` c'erano due sole cartelle, `create` e
 * `[id]/decide`, e l'unica altra scrittura sulla tabella `returns` in tutto il
 * repository azzerava le note alla cancellazione di un account.
 *
 * La conseguenza non era di forma. Il giro dei bonifici esclude dai pagamenti
 * gli ordini con un reso in REQUESTED, APPROVED, SHIPPED_BACK o RECEIVED. Un
 * cliente apre un reso, il negozio lo approva e aspetta la merce indietro: da
 * quel momento il bonifico di quell'ordine è fermo PER SEMPRE, anche se il reso
 * poi non arriva o si chiude di persona. Il negozio vedeva «in attesa» senza
 * scadenza e telefonava; l'amministratore non aveva nessun comando per
 * sbloccare.
 *
 * Qui c'è quel comando. Le tappe sono quelle già dichiarate nello schema del
 * database (migrazione 024), e ognuna parte solo dallo stato giusto:
 *  · APPROVED    → SHIPPED_BACK  il cliente ha rispedito
 *  · SHIPPED_BACK/APPROVED → RECEIVED  la merce è tornata
 *  · RECEIVED    → REFUNDED      i soldi tornano al cliente (chiude il reso)
 *  · qualunque stato aperto → CANCELED  il reso si chiude senza rimborso
 *    (merce mai partita, accordo di persona, cliente che ci ripensa): è la
 *    voce che libera il bonifico, e prima non c'era.
 *
 * Chi può: il venditore del reso, o un amministratore.
 */
const Body = z.object({
  stato: z.enum(['SHIPPED_BACK', 'RECEIVED', 'REFUNDED', 'CANCELED']),
  note: z.string().max(1000).optional(),
  refundAmountCents: z.number().int().positive().optional(),
});

/** Da dove si può arrivare a ogni tappa. Fuori da qui non si passa. */
const PARTENZE_AMMESSE: Record<string, string[]> = {
  SHIPPED_BACK: ['APPROVED'],
  RECEIVED: ['APPROVED', 'SHIPPED_BACK'],
  REFUNDED: ['RECEIVED'],
  CANCELED: ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'],
};

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: ret, error } = await supa
    .from('returns')
    .select('id, status, seller_id, buyer_id, order_id, refund_amount_cents')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');
  if (ret.seller_id !== user.id) {
    const { data: prof } = await supa.from('profiles').select('role').eq('id', user.id).single();
    if (prof?.role !== 'admin') return ApiErrors.forbidden();
  }

  const partenze = PARTENZE_AMMESSE[body.stato];
  if (!partenze.includes(ret.status)) {
    return ApiErrors.conflict(`Un reso in ${ret.status} non può passare a ${body.stato}.`);
  }

  const admin = getAdminSupabase();

  // Il rimborso si controlla PRIMA di prendere il turno, come su `decide`: un
  // importo impossibile non deve lasciare traccia sul reso, e il venditore deve
  // leggere il motivo invece di un guasto tecnico.
  const COLONNE_ORDINE = 'stripe_payment_intent, payment_method, gross_total_cents, total_price, refunded_amount_cents';
  type OrdineDelReso = {
    stripe_payment_intent: string | null;
    payment_method: string | null;
    gross_total_cents?: number | null;
    total_price: number | string | null;
    refunded_amount_cents: number | null;
  };
  let ordine: OrdineDelReso | null = null;
  let importoRimborso = 0;

  if (body.stato === 'REFUNDED') {
    const { data } = await conRipiegoSchema(
      'orders.select (avanzamento del reso)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', ret.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', ret.order_id).single(),
    );
    ordine = (data ?? null) as OrdineDelReso | null;
    if (!ordine) return ApiErrors.notFound('Ordine del reso non trovato');

    const lordoCent = ordine.gross_total_cents ?? Math.round(Number(ordine.total_price ?? 0) * 100);
    const residuoCent = Math.max(0, lordoCent - (ordine.refunded_amount_cents ?? 0));
    // Se non è indicato niente si rimborsa quello che il venditore aveva già
    // promesso quando ha approvato il reso.
    importoRimborso = body.refundAmountCents ?? Number(ret.refund_amount_cents ?? 0) ?? 0;
    if (importoRimborso <= 0) {
      return ApiErrors.invalidRequest('Indica quanto rimborsare al cliente.');
    }
    if (residuoCent <= 0) {
      return ApiErrors.conflict('Questo ordine è già stato rimborsato per intero: non resta niente da restituire.');
    }
    if (importoRimborso > residuoCent) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che resta dell ordine: al massimo ${(residuoCent / 100).toFixed(2)} €.`,
      );
    }
    if (!!ordine.stripe_payment_intent && !isStripeConfigured()) {
      return ApiErrors.unavailable('Stripe non configurato: impossibile emettere il rimborso ora.');
    }
  }

  // Il turno si prende con la scrittura: due schede aperte sullo stesso reso
  // non possono farlo avanzare due volte.
  const statoPrecedente = ret.status;
  const { data: preso, error: errPresa } = await admin
    .from('returns')
    .update({
      status: body.stato,
      decision_notes: body.note ?? null,
      ...(body.stato === 'REFUNDED' ? { refund_amount_cents: importoRimborso } : {}),
    })
    .eq('id', params.id)
    .eq('status', statoPrecedente)
    .select('id');

  if (errPresa) return ApiErrors.internal('Aggiornamento del reso fallito');
  if (!preso || preso.length === 0) {
    return ApiErrors.conflict("Il reso è già stato aggiornato da un'altra sessione");
  }

  let refundId: string | null = null;
  if (body.stato === 'REFUNDED') {
    try {
      const res = await refundOrder({
        orderId: ret.order_id,
        amountCents: importoRimborso,
        reason: body.note ?? 'requested_by_customer',
        metadata: { return_id: ret.id },
        idempotencyKey: `return_${ret.id}`,
        notifyBuyer: true,
      });
      refundId = res.refundId;
    } catch (err) {
      logger.error('[returns/avanza] rimborso fallito', err);
      // I soldi non sono usciti: il reso torna dov'era, così resta lavorabile
      // invece di restare fermo su «rimborsato» senza rimborso.
      await admin
        .from('returns')
        .update({ status: statoPrecedente })
        .eq('id', params.id)
        .eq('status', 'REFUNDED');
      return ApiErrors.badGateway('Rimborso fallito: ' + (err instanceof Error ? err.message : 'unknown'));
    }
    await admin
      .from('returns')
      .update({ refund_id: refundId, refunded_at: new Date().toISOString() })
      .eq('id', params.id);
  }

  const TITOLO: Record<string, string> = {
    SHIPPED_BACK: '📦 Reso: merce in viaggio',
    RECEIVED: '📥 Reso: merce ricevuta dal negozio',
    REFUNDED: '✓ Reso rimborsato',
    CANCELED: '✕ Reso chiuso senza rimborso',
  };
  await admin.from('notifications').insert({
    // #33 — la categoria decide se la persona vuole ancora ricevere questo
    // tipo di avviso: senza, gli interruttori non spegnevano niente.
    category: 'order',
    user_id: ret.buyer_id,
    title: TITOLO[body.stato],
    body: body.note ?? null,
    link: `/orders/${ret.order_id}`,
  });

  return NextResponse.json({ ok: true, status: body.stato, refundId }, { status: 200 });
}

// Stesso freno della decisione sul reso: tocca i soldi.
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAuthRateLimit({ name: 'returns-avanza', max: 30, windowMs: 10 * 60_000 }, async ({ user }) =>
    handler(req, user, await ctx.params))(req);
