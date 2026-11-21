import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { accountAssistenza } from '@/lib/admin/account-assistenza';

export const runtime = 'nodejs';

const Schema = z.object({
  firstMessage: z.string().trim().min(1, 'Messaggio vuoto').max(4000, 'Massimo 4000 caratteri'),
  // 20/11/2026 (R04-012) — La chiave dell'invio (components/SupportChatModal.tsx): la stessa nei
  // ritentativi dello stesso messaggio. Facoltativa: chi non la manda invia come prima.
  idempotency_key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Chiave dell’invio non valida')
    .optional(),
});

/**
 * 20/11/2026 (R04-012) — DUE INVII UGUALI NELLO STESSO ISTANTE FACEVANO DUE MESSAGGI E DUE AVVISI.
 *
 * Doppio clic o rete che ritenta: due richieste con lo stesso testo creavano due messaggi
 * all'Assistenza e due campanelle «Nuova richiesta di assistenza». Come per gli ordini in contanti
 * (`idOrdiniDelTentativo`, lib/ordini/chiave-dopo-l-errore.ts), il legame non chiede colonne nuove:
 * l'identificativo del messaggio nasce da persona + chiave dell'invio (SHA-256 in forma di UUID), e
 * la chiave primaria di `messages` rifiuta da sola il secondo (23505). Chi arriva secondo risponde
 * «già ricevuto», senza un altro messaggio né un altro avviso.
 */
async function idDelMessaggio(utente: string, chiave: string): Promise<string> {
  const impronta = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mycity:assistenza:${utente}:${chiave}`)),
  );
  const b = Array.from(impronta.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // forma di un UUID versione 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
      if (error) throw new Error(`conversazione con l'Assistenza non letta: ${error.code ?? ''} ${error.message}`, { cause: error });
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
  const { firstMessage, idempotency_key: chiaveInvio } = parsed.data;

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
  // Un guasto nel cercarla non vuol dire «non c'è»: crearne un'altra urterebbe il vincolo di
  // unicità e il primo messaggio del cliente andrebbe perso con un 500.
  const { data: existing, error: erroreRicerca } = await admin
    .from('conversations')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('seller_id', support.id)
    .maybeSingle();
  if (erroreRicerca) {
    logger.error(erroreRicerca, { context: 'support-conversazione-esistente' });
    return ApiErrors.unavailable('Assistenza momentaneamente non raggiungibile');
  }

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: created, error } = await admin
      .from('conversations')
      .insert({ buyer_id: user.id, seller_id: support.id })
      .select('id')
      .single();
    if (error?.code === '23505') {
      // Due richieste insieme: l'altra l'ha appena creata. Si rilegge e si usa quella.
      const { data: gia } = await admin
        .from('conversations')
        .select('id')
        .eq('buyer_id', user.id)
        .eq('seller_id', support.id)
        .maybeSingle();
      conversationId = (gia as { id: string } | null)?.id ?? null;
      if (!conversationId) return ApiErrors.internal('Impossibile aprire la conversazione');
    } else {
      if (error || !created) return ApiErrors.internal('Impossibile aprire la conversazione');
      conversationId = created.id;
    }
  }

  const { error: msgErr } = await admin.from('messages').insert({
    ...(chiaveInvio ? { id: await idDelMessaggio(user.id, chiaveInvio) } : {}),
    conversation_id: conversationId,
    sender_id: user.id,
    body: firstMessage,
  });
  // R04-012 — Lo stesso invio è già arrivato (doppio clic, ritentativo): niente secondo avviso.
  if (msgErr?.code === '23505' && chiaveInvio) {
    return NextResponse.json({ conversationId, supportId: support.id, giaRicevuto: true }, { status: 200 });
  }
  if (msgErr) return ApiErrors.internal('Impossibile inviare il messaggio');

  // 5/11/2026 (S05) — La campanella dell'Assistenza: prima la richiesta d'aiuto
  // entrava muta, e restava muta anche ai messaggi dopo (l'avviso della chat
  // suona solo al primo non letto). Il messaggio è già salvato: un guasto qui
  // non fa fallire l'invio, si annota.
  const { error: errAvviso } = await admin.from('notifications').insert({
    category: 'system',
    user_id: support.id,
    title: 'Nuova richiesta di assistenza',
    body: firstMessage.length > 140 ? `${firstMessage.slice(0, 139)}…` : firstMessage,
    link: `/messages/${conversationId}`,
  });
  if (errAvviso) logger.error('[support] campanella dell assistenza non scritta', { conversationId, message: errAvviso.message });

  // supportId: la chat appena aperta si chiama «Assistenza MyCity» subito, senza aspettare la GET.
  return NextResponse.json({ conversationId, supportId: support.id }, { status: 200 });
});
