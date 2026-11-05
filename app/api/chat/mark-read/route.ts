import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

const Schema = z.object({ conversationId: z.string().uuid() });

/**
 * POST /api/chat/mark-read
 * Azzera il counter unread del lato chiamante e marca i messaggi non letti
 * dell'altro lato come letti (read_at = now()). Idempotente.
 */
// Rate limit alto (operazione frequente in UI chat): 300 / 5 min
export const POST = withAuthRateLimit({ name: 'chat-mark-read', max: 300, windowMs: 5 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  let json: unknown;
  try { json = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Input non valido');

  const supa = await getServerSupabase();
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

  // S10 (5/11/2026) — Dalla migrazione 115 la sessione della persona puo'
  // aggiornare solo i PROPRI messaggi: l'update diretto sui messaggi dell'altro
  // veniva scartato senza dire niente. «Letto il» passa dalla funzione del
  // database fatta per questo, e l'esito si legge.
  const { error: erroreLettura } = await supa.rpc('mark_conversation_read', {
    p_conversation_id: parsed.data.conversationId,
  });
  if (erroreLettura) return ApiErrors.internal('Non sono riuscito a segnare i messaggi come letti.');

  return NextResponse.json({ ok: true });
});
