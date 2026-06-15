import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, 'Messaggio vuoto').max(4000, 'Massimo 4000 caratteri'),
});

/**
 * POST /api/chat/messages
 * Invia un nuovo messaggio nella conversazione indicata. RLS verifica che il
 * sender sia un partecipante. Il trigger DB aggiorna preview e counter unread.
 *
 * Rate limit dedicato anti-flood: max 30 msg/min per utente (per IP qui).
 */
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `chat:msg:${ip}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = SendSchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  const { conversationId, body } = parsed.data;

  const supa = await getServerSupabase();
  const { data, error } = await supa
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select('id, created_at')
    .single();

  if (error || !data) return ApiErrors.forbidden('Impossibile inviare il messaggio');

  return NextResponse.json({ id: data.id, createdAt: data.created_at }, { status: 200 });
});
