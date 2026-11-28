import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { POST as inviaMessaggio } from '@/app/api/chat/messages/route';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';

export const runtime = 'nodejs';

/**
 * Le risposte della rotta dei messaggi che vengono dal salvataggio stesso: il database ha
 * rifiutato (403 permesso, che vale anche per un account sospeso), non ha restituito la riga (404),
 * il messaggio c'era già (409) o si è guastato (500). Lì l'inserimento diretto avrebbe la stessa
 * risposta, e un 403 non va aggirato. Ogni altro rifiuto arriva PRIMA del salvataggio.
 */
const RISPOSTE_DEL_SALVATAGGIO = new Set([403, 404, 409, 500]);

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
// R09-006 — Una fila per richiesta per i lavori dopo la risposta (email, campanelle): vedi lib/api/fila-per-richiesta.ts.
export const POST = conFilaPerRichiesta(withAuth(async ({ user, req }): Promise<NextResponse> => {
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
    // Il primo messaggio passa dalla rotta dei messaggi normali: stesso salvataggio e stesso avviso
    // al negozio (campanella ed email, una volta sola), senza ricopiarne le regole. Prima si
    // inseriva qui direttamente, e il negozio non sapeva di avere un messaggio.
    let risposta: number | null = null;
    try {
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
      risposta = inviato.status;
    } catch (e) {
      logger.warn('[chat/conversations] rotta dei messaggi non raggiunta', {
        conversationId, message: e instanceof Error ? e.message : String(e),
      });
    }
    // Se la rotta dei messaggi ha detto di no prima di provare a salvare (il suo freno, la seconda
    // autenticazione caduta o non disponibile, un'eccezione), prima della riparazione il messaggio
    // si salvava: si salva come prima, con l'inserimento diretto. Senza avviso, ma non perso.
    if (risposta === null || (risposta >= 300 && !RISPOSTE_DEL_SALVATAGGIO.has(risposta))) {
      const { error: erroreDiretto } = await supa.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: firstMessage,
      });
      logger.warn('[chat/conversations] primo messaggio salvato senza avviso al negozio', {
        conversationId, status: risposta, salvato: !erroreDiretto,
      });
    } else if (risposta >= 300) {
      logger.warn('[chat/conversations] primo messaggio non salvato', { conversationId, status: risposta });
    }
  }

  return NextResponse.json({ conversationId }, { status: 200 });
}));
