import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const StartSchema = z.object({
  sellerId: z.string().uuid('Seller non valido'),
  firstMessage: z.string().trim().min(1, 'Messaggio vuoto').max(4000, 'Massimo 4000 caratteri').optional(),
});

/**
 * POST /api/chat/conversations
 * Crea (o recupera, se già esistente) una conversazione tra l'utente corrente
 * (sempre buyer) e il seller indicato. Se firstMessage è presente, lo invia
 * in atomicità best-effort: crea la conv, poi inserisce il primo messaggio.
 *
 * Risponde con { conversationId } pronto per navigare a /messages/[id].
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit({ key: `chat:start:${ip}`, max: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Troppe richieste, riprova tra poco' }, { status: 429 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
  }
  const parsed = StartSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Input non valido' }, { status: 400 });
  }
  const { sellerId, firstMessage } = parsed.data;

  if (sellerId === user.id) {
    return NextResponse.json({ error: 'Non puoi scriverti da solo' }, { status: 400 });
  }

  const supa = getServerSupabase();

  // Verifica che sellerId sia effettivamente un seller approvato (non scrivere
  // a buyer / rider / negozi sospesi). Evita anche enumeration di utenti.
  const { data: sellerProfile } = await supa
    .from('profiles')
    .select('id, role, is_approved')
    .eq('id', sellerId)
    .single();
  if (!sellerProfile || sellerProfile.role !== 'seller' || !sellerProfile.is_approved) {
    return NextResponse.json({ error: 'Venditore non disponibile' }, { status: 404 });
  }

  // Upsert idempotente: se esiste già, restituisce l'id.
  const { data: existing } = await supa
    .from('conversations')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('seller_id', sellerId)
    .maybeSingle();

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: created, error } = await supa
      .from('conversations')
      .insert({ buyer_id: user.id, seller_id: sellerId })
      .select('id')
      .single();
    if (error || !created) {
      return NextResponse.json({ error: 'Impossibile aprire la conversazione' }, { status: 500 });
    }
    conversationId = created.id;
  }

  if (firstMessage) {
    await supa.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: firstMessage,
    });
  }

  return NextResponse.json({ conversationId }, { status: 200 });
}
