import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { scriviCampanella } from '@/lib/ordini/campanella';
import { escapeHtml } from '@/lib/html-escape';

export const runtime = 'nodejs';

/**
 * 12/11/2026 (R03-013) — IL RECLAMO LO APRE IL SERVER, E QUALCUNO LO SA.
 *
 * La pagina «Apri un reclamo» scriveva la riga in `disputes` direttamente dal browser e diceva
 * «il team lo prenderà in carico entro 48h». Nessuno veniva avvisato: niente avviso agli
 * amministratori, niente al negozio, niente ricevuta al cliente. Intanto il giro dei bonifici
 * toglieva l'ordine dal pagamento (un reclamo aperto lo ferma), e il negozio non sapeva perché.
 *
 * Qui, coi permessi di servizio: l'ordine dev'essere del cliente, il reclamo è contro il negozio
 * dell'ordine (non quello che dice il browser), un reclamo aperto per ordine (l'indice unico
 * della tabella), poi l'avviso agli amministratori, la campanella al negozio e l'email di
 * ricevuta al cliente. Gli avvisi sono best-effort: il reclamo è già scritto.
 */
const REASON = z.enum(['not_received', 'damaged', 'wrong_item', 'not_as_described', 'seller_unreachable', 'other']);

const Body = z.object({
  orderId: z.string().uuid(),
  reason: REASON,
  description: z.string().trim().min(20).max(4000),
});

const MOTIVI: Record<z.infer<typeof REASON>, string> = {
  not_received: 'non ricevuto',
  damaged: 'arrivato danneggiato',
  wrong_item: 'prodotto sbagliato',
  not_as_described: 'non come descritto',
  seller_unreachable: 'negozio irraggiungibile',
  other: 'altro',
};

export const POST = withAuthRateLimit({ name: 'disputes-create', max: 10, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('La richiesta è troppo grande: scrivi una descrizione più corta.');
    return ApiErrors.invalidRequest('Dati non validi: scegli un motivo e descrivi il problema (almeno 20 caratteri).');
  }

  const admin = getAdminSupabase();
  const { data: order, error: oErr } = await admin
    .from('orders')
    .select('id, user_id, seller_id')
    .eq('id', body.orderId)
    .maybeSingle();
  if (oErr) return ApiErrors.unavailable("Non riesco a leggere l'ordine: riprova fra poco.");
  if (!order) return ApiErrors.notFound('Ordine non trovato');
  if (order.user_id !== user.id) return ApiErrors.forbidden();

  const { data: reclamo, error: insErr } = await admin
    .from('disputes')
    .insert({
      order_id: order.id,
      opener_id: user.id,
      against_id: order.seller_id ?? null,
      reason: body.reason,
      description: body.description,
      status: 'open',
    })
    .select('id')
    .single();
  if (insErr || !reclamo) {
    if (insErr?.code === '23505' || /disputes_one_open_per_order/.test(insErr?.message ?? '')) {
      return ApiErrors.conflict('Hai già un reclamo aperto su questo ordine: lo stiamo esaminando, ti scriviamo noi.');
    }
    logger.error(insErr, { context: 'disputes-insert', orderId: order.id });
    return ApiErrors.internal('Non sono riuscito ad aprire il reclamo: riprova fra poco.');
  }

  const breve = order.id.slice(0, 8);
  const motivo = MOTIVI[body.reason];

  try {
    await notifyAdmins(
      '⚖️ Nuovo reclamo da gestire',
      `Reclamo sull'ordine #${breve} (${motivo}): «${body.description.slice(0, 200)}». ` +
        "Il bonifico di quell'ordine resta fermo finché il reclamo è aperto.",
      '/admin/disputes',
      { unaVoltaPer: `reclamo-nuovo:${reclamo.id}` },
    );
  } catch (e) {
    logger.error('[disputes] avviso agli amministratori del nuovo reclamo non partito', { orderId: order.id, e });
  }

  if (order.seller_id) {
    await scriviCampanella(admin, {
      user_id: order.seller_id,
      category: 'order',
      title: '⚖️ Un cliente ha aperto un reclamo',
      body: `Reclamo sull'ordine #${breve} (${motivo}). Ti scriviamo per sentire la tua versione; intanto il bonifico di quell'ordine resta fermo.`,
      link: `/seller/orders/${order.id}`,
    }, {
      dove: 'disputes-create',
      ordine: order.id,
      ripiego: {
        titolo: '⚖️ Nuovo reclamo (avviso al negozio non scritto)',
        corpo: `Reclamo sull'ordine #${breve}, ma l'avviso al negozio non è partito: avvisalo tu.`,
        link: '/admin/disputes',
      },
    });
  }

  try {
    const { data: cliente } = await admin.auth.admin.getUserById(user.id);
    const email = cliente?.user?.email;
    if (email) {
      const testo =
        `Abbiamo ricevuto il tuo reclamo sull'ordine #${breve} (${motivo}). ` +
        'Lo leggiamo, sentiamo il negozio e ti scriviamo a questo indirizzo con la decisione.';
      const res = await sendEmail({
        to: email,
        subject: `Reclamo ricevuto — ordine #${breve}`,
        html: `<p>${escapeHtml(testo)}</p>`,
        text: testo,
        tipo: 'transazionale',
      });
      if (!res.ok) logger.warn('[disputes] ricevuta del reclamo al cliente non partita', { orderId: order.id });
    }
  } catch (e) {
    logger.warn('[disputes] ricevuta del reclamo al cliente non partita', { orderId: order.id, e });
  }

  return NextResponse.json({ ok: true, data: { id: reclamo.id, status: 'open' } }, { status: 201 });
});
