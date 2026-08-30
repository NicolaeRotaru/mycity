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

const Body = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().max(1000).optional(),
  refundAmountCents: z.number().int().positive().optional(),
});

/**
 * Seller decide sul reso (APPROVED o REJECTED). Se APPROVED ed e' stato
 * fornito refundAmountCents, emette subito un rimborso parziale Stripe;
 * altrimenti il rimborso e' lasciato a quando il pacco torna indietro
 * (transizione RECEIVED -> REFUNDED via altro endpoint).
 */
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
    .select('id, status, seller_id, buyer_id, order_id, reason, refund_amount_cents')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');
  if (ret.seller_id !== user.id) {
    // Admin puo' decidere comunque
    const { data: prof } = await supa.from('profiles').select('role').eq('id', user.id).single();
    if (prof?.role !== 'admin') return ApiErrors.forbidden();
  }
  if (ret.status !== 'REQUESTED') {
    return ApiErrors.conflict(`Reso gia' in stato ${ret.status}`);
  }

  // 🟠-22: il recesso (CHANGED_MIND) entro 14 giorni è INCONDIZIONATO (Cod. Cons.
  // art. 52-59): il venditore non può rifiutarlo. Può solo approvarlo ed elaborare
  // il rimborso (eventualmente alla restituzione del bene). Gli altri motivi
  // (danneggiato, sbagliato, ecc.) restano valutabili.
  if (ret.reason === 'CHANGED_MIND' && body.decision === 'REJECTED') {
    return ApiErrors.invalidRequest(
      'Il recesso entro 14 giorni è incondizionato e non può essere rifiutato (Cod. Cons. art. 52-59): approva ed elabora il rimborso.',
    );
  }

  const admin = getAdminSupabase();

  /**
   * 27/8/2026 (R138) — IL TETTO SULL'IMPORTO ARRIVAVA TROPPO TARDI, E IN FORMA
   * DI GUASTO.
   *
   * Lo schema del corpo accettava qualunque importo positivo, e la
   * rivendicazione scriveva su `returns.refund_amount_cents` l'importo CHIESTO,
   * non quello uscito. Il tetto vero stava a valle, dentro `refundOrder`, che
   * su un residuo a zero solleva un errore tecnico: quell'errore usciva come
   * 502 con il messaggio interno in chiaro. Al venditore arrivava «Rimborso
   * fallito: refundOrder: importo rimborso non valido» invece di «l'ordine e'
   * gia' stato rimborsato per intero», e nel pannello restava un numero che non
   * corrisponde a nessun movimento.
   *
   * Il controllo sta adesso PRIMA della rivendicazione: cosi' un importo
   * impossibile non lascia nessuna traccia sul reso, e l'importo scritto e'
   * quello che esce davvero (`refundOrder` non deve piu' tagliarlo).
   */
  const chiedeRimborso = body.decision === 'APPROVED' && !!body.refundAmountCents;
  const COLONNE_ORDINE = 'stripe_payment_intent, payment_method, gross_total_cents, total_price, refunded_amount_cents';
  type OrdineDelReso = {
    stripe_payment_intent: string | null;
    payment_method: string | null;
    gross_total_cents?: number | null;
    total_price: number | string | null;
    refunded_amount_cents: number | null;
  };
  let ordine: OrdineDelReso | null = null;

  if (chiedeRimborso) {
    const { data } = await conRipiegoSchema(
      'orders.select (decisione sul reso)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', ret.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', ret.order_id).single(),
    );
    ordine = (data ?? null) as OrdineDelReso | null;
    if (!ordine) return ApiErrors.notFound('Ordine del reso non trovato');

    const lordoCent = ordine.gross_total_cents ?? Math.round(Number(ordine.total_price ?? 0) * 100);
    const residuoCent = Math.max(0, lordoCent - (ordine.refunded_amount_cents ?? 0));
    if (residuoCent <= 0) {
      return ApiErrors.conflict('Questo ordine è già stato rimborsato per intero: non resta niente da restituire.');
    }
    if (body.refundAmountCents! > residuoCent) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che resta dell ordine: al massimo ${(residuoCent / 100).toFixed(2)} €.`,
      );
    }
  }

  let refundId: string | null = null;
  let refundedAt: string | null = null;
  let newStatus: string = body.decision;

  /**
   * 21/8/2026 — PRIMA SI PRENDE IL TURNO, POI ESCONO I SOLDI.
   *
   * Qui il rimborso partiva PRIMA della guardia di stato, e il commento diceva
   * che tanto era «protetto dalla chiave di idempotenza di Stripe». Vero per il
   * denaro: Stripe rimborsa una volta sola. Falso per i conti nostri:
   * `accumula_rimborso` e' un incremento senza chiave, quindi due decisioni
   * partite insieme sullo stesso reso incrementavano DUE VOLTE
   * `refunded_amount_cents`. L'ordine risultava rimborsato per il doppio di
   * quello che era davvero uscito, il residuo che spettava al cliente diventava
   * irrimborsabile e il rendiconto del negozio sottraeva due volte la stessa
   * cifra.
   *
   * Adesso la rivendicazione dello stato viene prima: passa una decisione sola.
   * Se poi il rimborso fallisce, lo stato torna indietro (piu' sotto), cosi' il
   * reso resta decidibile invece di restare bloccato a meta'.
   */
  const statoRivendicato = body.decision === 'APPROVED' ? 'APPROVED' : body.decision;
  const { data: rivendicato, error: errRivendica } = await admin
    .from('returns')
    .update({
      status: statoRivendicato,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      decision_notes: body.notes ?? null,
      refund_amount_cents: body.refundAmountCents ?? null,
    })
    .eq('id', params.id)
    .eq('status', 'REQUESTED')
    .select('id');

  if (errRivendica) return ApiErrors.internal('Update fallito');
  if (!rivendicato || rivendicato.length === 0) {
    return ApiErrors.conflict("Reso già deciso da un'altra sessione");
  }

  /** Rimette il reso in attesa: si usa solo quando i soldi non sono usciti. */
  const rimettiInAttesa = async () => {
    await admin
      .from('returns')
      .update({ status: 'REQUESTED', decided_at: null, decided_by: null, refund_amount_cents: null })
      .eq('id', params.id)
      .eq('status', statoRivendicato);
  };

  if (chiedeRimborso) {
    const isCard = !!ordine?.stripe_payment_intent;
    const isCod = !isCard && ordine?.payment_method === 'cod';

    // Carta ma Stripe non configurato → NON marcare come rimborsato in silenzio.
    if (isCard && !isStripeConfigured()) {
      await rimettiInAttesa();
      return ApiErrors.unavailable('Stripe non configurato: impossibile emettere il rimborso ora.');
    }

    if (isCard || isCod) {
      // refundOrder gestisce sia il refund reale Stripe (carta + claw-back) sia
      // l'accredito sul wallet del buyer (COD, 🟠-18: il contante è già stato
      // incassato dal rider). Idempotente via idempotencyKey return_<id>.
      try {
        const res = await refundOrder({
          orderId: ret.order_id,
          amountCents: body.refundAmountCents!,
          reason: body.notes ?? 'requested_by_customer',
          metadata: { return_id: ret.id },
          idempotencyKey: `return_${ret.id}`,
          notifyBuyer: true,
        });
        refundId = res.refundId;
        refundedAt = new Date().toISOString();
        newStatus = 'REFUNDED';
      } catch (err) {
        logger.error('[returns] refund failed', err);
        // I soldi non sono usciti: il reso torna decidibile invece di restare
        // fermo su «approvato» senza rimborso.
        await rimettiInAttesa();
        return ApiErrors.badGateway('Rimborso fallito: ' + (err instanceof Error ? err.message : 'unknown'));
      }
    }
  }

  // Il turno era gia' stato preso sopra: qui si scrive solo l'esito del
  // rimborso. Se lo stato non e' cambiato (rifiuto, o approvazione senza
  // rimborso immediato) questa scrittura non tocca niente di nuovo.
  if (newStatus !== statoRivendicato || refundId) {
    const { error: updErr } = await admin
      .from('returns')
      .update({ status: newStatus, refund_id: refundId, refunded_at: refundedAt })
      .eq('id', params.id)
      .eq('status', statoRivendicato);
    if (updErr) return ApiErrors.internal('Update fallito');
  }

  // Notifica buyer
  await admin.from('notifications').insert({
    user_id: ret.buyer_id,
    title: body.decision === 'APPROVED' ? '✓ Reso approvato' : '✕ Reso rifiutato',
    body: body.notes ?? null,
    link: `/orders/${ret.order_id}`,
  });

  // Email di rimborso: già inviata da refundOrder (notifyBuyer: true).

  return NextResponse.json({ ok: true, status: newStatus, refundId }, { status: 200 });
}

// Rate limit: 30 decisioni / 10 min per seller (anti-abuse refund Stripe)
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAuthRateLimit({ name: 'returns-decide', max: 30, windowMs: 10 * 60_000 }, async ({ user }) => handler(req, user, await ctx.params))(req);
