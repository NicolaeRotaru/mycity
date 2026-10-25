import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const Schema = z.object({
  firstMessage: z.string().trim().min(1, 'Messaggio vuoto').max(4000, 'Massimo 4000 caratteri'),
});

/**
 * L'account Assistenza: il primo admin (fonte di verità nel DB, no hardcode).
 * Una funzione sola per chi apre la chat (POST) e per chi deve riconoscerla (GET):
 * se un giorno la regola cambia, cambia per tutti e due.
 *
 * Un guasto del database LANCIA: «non sono riuscita a chiedere» non è «non c'è
 * nessun admin», e scambiarli faceva ricordare il guasto come una risposta.
 */
async function accountAssistenza(admin: ReturnType<typeof getAdminSupabase>): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

/**
 * GET /api/support/conversation → `{ supportId }`
 *
 * 25/10/2026 — LA CHAT CON L'ASSISTENZA SI CHIAMAVA «UTENTE». Per il cliente la
 * controparte della conversazione è l'account Assistenza, che non è un negozio:
 * non sta nella vetrina pubblica e il suo profilo un cliente non lo legge. La
 * chat ripiegava su «Utente · Negozio» e chi cercava aiuto non riconosceva la
 * conversazione. La pagina chiede qui chi è l'Assistenza e la riconosce dal
 * seller_id.
 *
 * L'id esce SOLO verso chi ha già una conversazione con l'Assistenza, cioè chi quel
 * seller_id lo vede già nella sua chat: a tutti gli altri la risposta è `null`.
 * Niente memoria nel browser (`no-store`): la tiene React Query, solo nella scheda.
 */
export const GET = withAuth(async ({ user }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `support:who:${user.id}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  const admin = getAdminSupabase();
  let supportId: string | null = null;
  try {
    const support = await accountAssistenza(admin);
    if (support) {
      const { data: conv, error } = await admin
        .from('conversations')
        .select('id')
        .eq('buyer_id', user.id)
        .eq('seller_id', support.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      supportId = conv ? support.id : null;
    }
  } catch (e) {
    logger.error(e, { context: 'support-account-assistenza' });
    return ApiErrors.unavailable('Assistenza momentaneamente non raggiungibile');
  }
  return NextResponse.json({ supportId }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
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
  // 27/8/2026 (R026) — LA CHIAVE È LA PERSONA, NON L'INDIRIZZO DI RETE. La
  // rotta è dentro `withAuth`, quindi chi chiama è già identificato: frenare
  // per indirizzo qui fa due danni opposti. Da rete mobile o aziendale venti
  // persone condividono lo stesso contatore, e la chat con l'assistenza si
  // chiude a chi non ha fatto niente; chi vuole davvero inondarla cambia rete e
  // passa. La correzione era già stata fatta su /api/chat/conversations: qui
  // non era arrivata.
  const rl = await rateLimitAsync({ key: `support:start:${user.id}`, max: 20, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  const { firstMessage } = parsed.data;

  const admin = getAdminSupabase();

  let support: { id: string } | null;
  try {
    support = await accountAssistenza(admin);
  } catch (e) {
    logger.error(e, { context: 'support-account-assistenza' });
    return ApiErrors.unavailable('Assistenza momentaneamente non raggiungibile');
  }
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

  // supportId: la chat appena aperta si chiama «Assistenza MyCity» subito, senza aspettare la GET.
  return NextResponse.json({ conversationId, supportId: support.id }, { status: 200 });
});
