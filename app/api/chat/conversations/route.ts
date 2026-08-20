import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

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
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  // 188 — la chiave è la persona, non l'indirizzo di rete: chi sta su rete
  // mobile non deve essere fermato per colpa di uno sconosciuto.
  const rl = await rateLimitAsync({ key: `chat:start:${user.id}`, max: 20, windowMs: 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
  const parsed = StartSchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.errors[0]?.message ?? 'Input non valido');
  const { sellerId, firstMessage } = parsed.data;

  if (sellerId === user.id) return ApiErrors.invalidRequest('Non puoi scriverti da solo');

  const supa = await getServerSupabase();

  // Verifica che sellerId sia effettivamente un seller approvato (non scrivere
  // a buyer / rider / negozi sospesi). Evita anche enumeration di utenti.
  // #16 — Dalla vetrina pubblica: la tabella dei profili, con la sessione di un
  // cliente, non e' piu' leggibile da quando la 110 ha tolto la regola «chiunque
  // puo' vedere i negozi approvati». Questa lettura tornava vuota e la chat con
  // il negozio non si apriva piu' — con il messaggio «venditore non
  // disponibile», che suona come «quel negozio non c'e' piu'».
  // La vista contiene SOLO negozi approvati, quindi il controllo e' implicito.
  const { data: sellerProfile } = await supa
    .from('seller_public_profiles')
    .select('id')
    .eq('id', sellerId)
    .maybeSingle();
  if (!sellerProfile) {
    return ApiErrors.notFound('Venditore non disponibile');
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
    if (error) {
      // 185 — Due clic ravvicinati sul pulsante «Scrivi al negozio» arrivavano
      // qui insieme: tutti e due leggevano «non esiste», tutti e due
      // inserivano, e il secondo sbatteva sull'indice unico. L'utente vedeva
      // un errore generico su una cosa che in realtà era andata a buon fine.
      // Un doppione su una chiave unica non è un guasto: è la risposta.
      if (error.code === '23505') {
        const { data: gia } = await supa
          .from('conversations')
          .select('id')
          .eq('buyer_id', user.id)
          .eq('seller_id', sellerId)
          .maybeSingle();
        conversationId = gia?.id ?? null;
      }
      if (!conversationId) return ApiErrors.internal('Impossibile aprire la conversazione');
    } else if (created) {
      conversationId = created.id;
    }
    if (!conversationId) return ApiErrors.internal('Impossibile aprire la conversazione');
  }

  if (firstMessage) {
    await supa.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: firstMessage,
    });
  }

  return NextResponse.json({ conversationId }, { status: 200 });
});
