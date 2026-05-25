import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

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
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit({ key: `chat:msg:${ip}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Stai scrivendo troppo veloce, rallenta' }, { status: 429 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
  }
  const parsed = SendSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Input non valido' }, { status: 400 });
  }
  const { conversationId, body } = parsed.data;

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select('id, created_at')
    .single();

  if (error || !data) {
    // L'RLS impedisce di scrivere se non sei partecipante: errore generico
    // per non rivelare se la conv esiste.
    return NextResponse.json({ error: 'Impossibile inviare il messaggio' }, { status: 403 });
  }

  return NextResponse.json({ id: data.id, createdAt: data.created_at }, { status: 200 });
}
