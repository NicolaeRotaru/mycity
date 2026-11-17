import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { POST as inviaMessaggio } from '@/app/api/chat/messages/route';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

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
  try { json = await jsonRichiesta(req, TETTO_JSON); } catch { return ApiErrors.invalidRequest('Body JSON non valido'); }
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
    // R03-006 — Il primo messaggio passa dalla rotta dei messaggi normali: stesso salvataggio e
    // stesso avviso al negozio (campanella ed email), senza ricopiarne le regole. Prima si
    // inseriva qui direttamente, e il negozio non sapeva di avere un messaggio.
    const intestazioni = new Headers(req.headers);
    intestazioni.delete('content-length');
    intestazioni.set('content-type', 'application/json');
    const inviato = await inviaMessaggio(
      new NextRequest(new URL('/api/chat/messages', req.url), {
        method: 'POST',
        headers: intestazioni,
        body: JSON.stringify({ conversationId, body: firstMessage }),
      }),
    );
    if (inviato.status === 429 || inviato.status === 401) {
      // Giro di correzione: qui ha detto di no il freno dei messaggi o la seconda autenticazione,
      // non il database, e prima della riparazione il messaggio si salvava. Si salva come prima,
      // con l'inserimento diretto: senza avviso al negozio, ma non perso.
      const { error: erroreDiretto } = await supa
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: user.id, body: firstMessage });
      logger.warn('[chat/conversations] primo messaggio salvato senza avviso al negozio', {
        conversationId, status: inviato.status, salvato: !erroreDiretto,
      });
    } else if (!inviato.ok) {
      logger.warn('[chat/conversations] primo messaggio non inviato', { conversationId, status: inviato.status });
    }
  }

  return NextResponse.json({ conversationId }, { status: 200 });
});
