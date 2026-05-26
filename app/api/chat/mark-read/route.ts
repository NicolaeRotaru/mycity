import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Schema = z.object({ conversationId: z.string().uuid() });

/**
 * POST /api/chat/mark-read
 * Azzera il counter unread del lato chiamante e marca i messaggi non letti
 * dell'altro lato come letti (read_at = now()). Idempotente.
 */
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Input non valido');

  const supa = getServerSupabase();
  const { data: conv } = await supa
    .from('conversations')
    .select('buyer_id, seller_id')
    .eq('id', parsed.data.conversationId)
    .maybeSingle();

  if (!conv) return ApiErrors.notFound('Conversazione non trovata');

  const isBuyer = conv.buyer_id === user.id;
  const isSeller = conv.seller_id === user.id;
  if (!isBuyer && !isSeller) return ApiErrors.forbidden();

  const counterField = isBuyer ? 'buyer_unread_count' : 'seller_unread_count';

  await supa
    .from('conversations')
    .update({ [counterField]: 0 })
    .eq('id', parsed.data.conversationId);

  await supa
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', parsed.data.conversationId)
    .is('read_at', null)
    .neq('sender_id', user.id);

  return NextResponse.json({ ok: true });
});
