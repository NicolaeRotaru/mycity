import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getCurrentUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const Schema = z.object({ conversationId: z.string().uuid() });

/**
 * POST /api/chat/mark-read
 * Azzera il counter unread del lato chiamante e marca i messaggi non letti
 * dell'altro lato come letti (read_at = now()). Idempotente.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 }); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Input non valido' }, { status: 400 });

  const supa = getServerSupabase();
  const { data: conv } = await supa
    .from('conversations')
    .select('buyer_id, seller_id')
    .eq('id', parsed.data.conversationId)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 });

  const isBuyer = conv.buyer_id === user.id;
  const isSeller = conv.seller_id === user.id;
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });

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
}
