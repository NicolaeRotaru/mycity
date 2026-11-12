import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import {
  MOTIVO_RIPENSAMENTO,
  prodottiDelleRighe,
  rifiutoDelRecesso,
  type ProdottoPerIlRecesso,
  type RigaPerIlRecesso,
} from '@/lib/ordini/recesso';

export const runtime = 'nodejs';

/**
 * 12/11/2026 (R07-002) — IL «CAMBIO IDEA» SI PUÒ CHIEDERE SU QUEST'ORDINE?
 *
 * La pagina del reso spegne «Ho cambiato idea» quando tutti i prodotti dell'ordine sono esclusi
 * dal recesso (art. 59). Leggendo `products` col client del cliente, però, non vedeva i prodotti
 * tolti dalla vetrina dopo l'ordine (il pane segnato esaurito la sera): li contava come
 * recedibili e offriva il motivo, che poi `returns/create` rifiutava. Qui la risposta la dà il
 * server con la stessa lettura di `returns/create` (righe col client dell'utente, prodotti col
 * client di servizio), così pagina e server dicono la stessa cosa.
 */
const Query = z.object({ orderId: z.string().uuid() });

export const GET = withAuthRateLimit({ name: 'returns-ripensamento', max: 60, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  const parsed = Query.safeParse({ orderId: new URL(req.url).searchParams.get('orderId') });
  if (!parsed.success) return ApiErrors.invalidRequest('Ordine non valido');
  const { orderId } = parsed.data;

  const supa = await getServerSupabase();
  const { data: order, error: oErr } = await supa.from('orders').select('id, user_id').eq('id', orderId).maybeSingle();
  if (oErr) return ApiErrors.internal('Non riesco a leggere l\'ordine: riprova fra poco.');
  if (!order) return ApiErrors.notFound('Ordine non trovato');
  if (order.user_id !== user.id) return ApiErrors.forbidden();

  const { data: righe, error: rErr } = await supa.from('order_items').select('product_id, product_name').eq('order_id', orderId);
  if (rErr) {
    logger.error(rErr, { context: 'returns-ripensamento-righe' });
    return ApiErrors.internal('Non riesco a verificare i prodotti dell\'ordine: riprova fra poco.');
  }
  const righeOrdine = (righe ?? []) as RigaPerIlRecesso[];
  const ids = [...new Set(righeOrdine.map((r) => r.product_id).filter((x): x is string => typeof x === 'string'))];
  if (ids.length === 0) return NextResponse.json({ ok: true, rifiuto: null });

  // `*` come in returns/create: prima della migrazione 180 la colonna non c'è e vale «nessuno escluso».
  const { data: prodotti, error: pErr } = await getAdminSupabase().from('products').select('*').in('id', ids);
  if (pErr) {
    logger.error(pErr, { context: 'returns-ripensamento-prodotti' });
    return ApiErrors.internal('Non riesco a verificare se i prodotti sono esclusi dal recesso: riprova fra poco.');
  }
  const perRiga = prodottiDelleRighe(righeOrdine, (prodotti ?? []) as Array<ProdottoPerIlRecesso & { id?: string }>);
  return NextResponse.json({ ok: true, rifiuto: rifiutoDelRecesso(MOTIVO_RIPENSAMENTO, perRiga) });
});
