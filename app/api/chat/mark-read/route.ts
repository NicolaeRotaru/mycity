import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';

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

  // S10 (5/11/2026) — Dalla migrazione 115 la sessione della persona puo'
  // aggiornare solo i PROPRI messaggi: l'update diretto sui messaggi dell'altro
  // veniva scartato senza dire niente. «Letto il» passa dalla funzione del
  // database fatta per questo, e l'esito si legge.
  const { error: erroreLettura } = await supa.rpc('mark_conversation_read', {
    p_conversation_id: parsed.data.conversationId,
  });
  if (erroreLettura) return ApiErrors.internal('Non sono riuscito a segnare i messaggi come letti.');

  // 13/11/2026 (R22-012) — L'azzeramento del contatore non guardava il suo esito e la rotta
  // rispondeva sempre ok: se la scrittura cadeva, il «non letto» restava e nessuno lo sapeva.
  const { error: erroreContatore } = await supa
    .from('conversations')
    .update({ [counterField]: 0 })
    .eq('id', parsed.data.conversationId);
  if (erroreContatore) return ApiErrors.internal('Non sono riuscito a segnare la conversazione come letta.');

  // 13/11/2026 (R22-009) — IL «LETTO» HA DUE SEGNI, E QUI SE NE AZZERAVA UNO SOLO.
  // Il contatore della chat tornava a zero, ma la voce in campanella («Nuovo messaggio da un
  // cliente») restava non letta: si segnava solo da /notifications. A ogni giro di messaggi il
  // contatore ripartiva da 1 e la rotta dei messaggi aggiungeva una voce nuova: cinque scambi
  // letti subito, cinque voci accese per una chat già letta. Aprire la chat spegne anche le voci
  // di chi legge per questa conversazione. Best effort: i messaggi sono già segnati letti.
  const { error: erroreCampanella } = await supa
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('link', `/messages/${parsed.data.conversationId}`)
    .eq('is_read', false);
  if (erroreCampanella) {
    logger.warn('[chat/mark-read] voci della campanella non segnate lette', {
      conversationId: parsed.data.conversationId,
      message: erroreCampanella.message,
    });
  }

  return NextResponse.json({ ok: true });
});
