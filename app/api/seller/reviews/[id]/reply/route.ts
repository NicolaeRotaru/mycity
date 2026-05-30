import { type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';

export const runtime = 'nodejs';

const MAX_LEN = 500;

/**
 * POST /api/seller/reviews/:id/reply
 * Il venditore pubblica (o modifica) la risposta a una recensione del proprio
 * negozio. Auth: solo il seller proprietario (store_id === user.id). La scrittura
 * usa il client admin perché store_reviews non espone una policy UPDATE; la
 * verifica di ownership è fatta esplicitamente qui.
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }) {
  let body: { reply?: unknown };
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('Corpo della richiesta non valido');
  }

  const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
  if (!reply) return ApiErrors.invalidRequest('La risposta non può essere vuota');
  if (reply.length > MAX_LEN) return ApiErrors.invalidRequest(`Massimo ${MAX_LEN} caratteri`);

  const admin = getAdminSupabase();

  const { data: review, error } = await admin
    .from('store_reviews')
    .select('id, store_id')
    .eq('id', params.id)
    .single();

  if (error || !review) return ApiErrors.notFound('Recensione non trovata');
  if (review.store_id !== user.id) return ApiErrors.forbidden();

  const seller_reply_at = new Date().toISOString();
  const { error: upErr } = await admin
    .from('store_reviews')
    .update({ seller_reply: reply, seller_reply_at })
    .eq('id', params.id);

  if (upErr) return ApiErrors.internal('Impossibile salvare la risposta');

  return apiSuccess({ id: params.id, seller_reply: reply, seller_reply_at });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withSellerAuth(async ({ user }) => handler(req, user, await ctx.params))(req);
