import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Schema = z.object({
  firstMessage: z.string().trim().min(1, 'Messaggio vuoto').max(4000, 'Massimo 4000 caratteri'),
});

/**
 * POST /api/support/conversation
 * Trova-o-crea la conversazione tra l'utente corrente e l'account "Assistenza"
 * (un profilo con role='admin') e invia il primo messaggio. Riusa le tabelle
 * conversations/messages esistenti: per il buyer la chat appare come una normale
 * conversazione, l'admin la vede e risponde dalla sua inbox /messages.
 *
 * Usa l'admin client SOLO per il find-or-create (l'endpoint chat standard
 * accetta solo seller approvati): la lettura/scrittura successiva resta sotto RLS
 * (l'utente è buyer_id della conversazione).
 */
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `support:start:${ip}`, max: 20, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  const { firstMessage } = parsed.data;

  const admin = getAdminSupabase();

  // Account assistenza: il primo admin (fonte di verità nel DB, no hardcode).
  const { data: support } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!support) return ApiErrors.notFound('Assistenza non disponibile');
  if (support.id === user.id) return ApiErrors.invalidRequest('Sei l\'account assistenza');

  // Find-or-create: l'utente è sempre buyer_id, l'assistenza è seller_id.
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('seller_id', support.id)
    .maybeSingle();

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: created, error } = await admin
      .from('conversations')
      .insert({ buyer_id: user.id, seller_id: support.id })
      .select('id')
      .single();
    if (error || !created) return ApiErrors.internal('Impossibile aprire la conversazione');
    conversationId = created.id;
  }

  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: firstMessage,
  });
  if (msgErr) return ApiErrors.internal('Impossibile inviare il messaggio');

  return NextResponse.json({ conversationId }, { status: 200 });
});
