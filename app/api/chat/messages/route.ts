import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rispostaPerErroreDatabase } from '@/lib/api/errore-database';

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
 * Freno anti-alluvione: 30 messaggi al minuto per PERSONA.
 *
 * 188 — Prima la chiave era l'indirizzo di rete. Ma qui si è già autenticati:
 * chi naviga da rete mobile condivide l'indirizzo con centinaia di sconosciuti e
 * si trovava zittito per colpa loro, mentre chi voleva davvero inondare la chat
 * cambiava rete. La chiave giusta è chi scrive, e la sappiamo.
 */
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `chat:msg:${user.id}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = SendSchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  const { conversationId, body } = parsed.data;

  const supa = await getServerSupabase();
  const { data, error } = await supa
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select('id, created_at')
    .single();

  // 22/8/2026 — qui si rispondeva 403 per qualunque guasto: permesso negato,
  // connessione caduta, database in manutenzione. Chi legge 403 pensa di non
  // poter scrivere a quella persona e smette di provare — e nei log non resta
  // niente, perché un 403 è una risposta normale che nessuno va a guardare.
  if (error) return rispostaPerErroreDatabase(error, 'chat/messages', 'Impossibile inviare il messaggio');
  if (!data) return ApiErrors.internal('Impossibile inviare il messaggio');

  return NextResponse.json({ id: data.id, createdAt: data.created_at }, { status: 200 });
});
