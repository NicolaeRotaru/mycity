import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { fotoDiCasa } from '@/lib/storage/foto-di-casa';

export const runtime = 'nodejs';

const REASON = z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'LATE', 'OTHER']);

const Body = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid().optional(),
  reason: REASON,
  notes: z.string().max(2000).optional(),
  // 27/8/2026 (R021) — Era `z.string().url()`, che con zod 3 accetta anche
  // `javascript:` e `data:`. Quel valore finisce dentro un `<a href>` nella
  // scheda che il negoziante apre per decidere il reso: un indirizzo scelto
  // dall'utente dentro un collegamento, senza nessuna verifica. Le foto di un
  // reso stanno nel nostro archivio, e solo li'.
  photoUrls: z
    .array(z.string().refine(fotoDiCasa, 'Le foto del reso devono stare nell archivio di MyCity'))
    .max(8)
    .optional(),
});

/**
 * Apre una richiesta di reso. Vincoli:
 *  - L'ordine deve essere DELIVERED
 *  - L'utente deve esserne il buyer
 *  - Entro 14 giorni dalla consegna (recesso legale)
 *
 * Lo stato iniziale e' REQUESTED. Il seller ricevera' notifica e
 * potra' approvare/rifiutare via /api/returns/[id]/decide.
 */
// Rate limit: 10 reso / ora per utente (anti-spam reso fraudolento)
export const POST = withAuthRateLimit({ name: 'returns-create', max: 10, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: order, error: oErr } = await supa
    .from('orders')
    .select('id, user_id, seller_id, delivery_status, delivered_at, total_price, created_at')
    .eq('id', body.orderId)
    .single();

  if (oErr || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.user_id !== user.id) return ApiErrors.forbidden();
  if (order.delivery_status !== 'DELIVERED') return ApiErrors.invalidRequest("L'ordine non risulta consegnato");

  /**
   * Vincolo 14 giorni dalla consegna (recesso).
   *
   * 27/8/2026 (R128) — IL TERMINE SALTAVA DEL TUTTO SENZA LA DATA DI CONSEGNA.
   * Il conto stava dentro `if (order.delivered_at)`: colonna vuota, blocco non
   * eseguito, reso aperto senza nessun limite di tempo. Oggi il caso non si
   * raggiunge perche' tutte le strade verso DELIVERED scrivono anche la data —
   * ma e' una difesa che, quando si rompe, si rompe nel verso sbagliato: lascia
   * passare invece di rifiutare. E il giorno in cui una strada nuova chiude un
   * ordine senza scrivere la data si aprono due difetti insieme, perche' la
   * stessa colonna governa l'ammissibilita' dei bonifici
   * (`release-payouts` filtra su `delivered_at`).
   *
   * Senza la data di consegna si conta dalla data dell'ordine: e' sempre
   * precedente alla consegna, quindi il cliente non perde mai giorni che gli
   * spettano, e il termine non sparisce.
   */
  const baseRecesso = order.delivered_at ?? order.created_at;
  if (baseRecesso) {
    const days = (Date.now() - new Date(baseRecesso).getTime()) / (1000 * 60 * 60 * 24);
    if (days > 14) return ApiErrors.invalidRequest('Termine per il recesso scaduto (14 giorni dalla consegna).');
  }

  // 186 — L'articolo indicato non veniva verificato: si poteva chiedere il reso
  // di un prodotto di un ALTRO ordine, e il negoziante si trovava una richiesta
  // che non torna con niente. Se c'è un articolo, deve essere di quest'ordine.
  if (body.orderItemId) {
    const { data: riga } = await supa
      .from('order_items')
      .select('id')
      .eq('id', body.orderItemId)
      .eq('order_id', body.orderId)
      .maybeSingle();
    if (!riga) return ApiErrors.invalidRequest("L'articolo indicato non appartiene a questo ordine");
  }

  // Anti-doppione: max 1 reso open per ordine
  const { data: existing } = await supa
    .from('returns')
    .select('id, status')
    .eq('order_id', body.orderId)
    .in('status', ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'])
    .limit(1)
    .maybeSingle();
  if (existing) return ApiErrors.invalidRequest("Esiste già una richiesta di reso aperta per questo ordine");

  const admin = getAdminSupabase();
  const { data: ret, error: insErr } = await admin
    .from('returns')
    .insert({
      order_id: body.orderId,
      order_item_id: body.orderItemId ?? null,
      buyer_id: user.id,
      seller_id: order.seller_id,
      reason: body.reason,
      notes: body.notes ?? null,
      photo_urls: body.photoUrls ?? [],
      status: 'REQUESTED',
    })
    .select('id')
    .single();

  if (insErr || !ret) {
    // 186 — Il controllo qui sopra non è atomico: due invii ravvicinati lo
    // superano entrambi. L'indice unico parziale della migrazione 119 è la
    // guardia vera; qui si traduce il suo rifiuto in una risposta che si capisce
    // invece che in un errore interno.
    if (insErr?.code === '23505') {
      return ApiErrors.conflict('Esiste già una richiesta di reso aperta per questo ordine');
    }
    logger.error(insErr, { context: 'returns-insert' });
    return ApiErrors.internal('Creazione reso fallita');
  }

  // Notifica seller (best-effort)
  await admin.from('notifications').insert({
    user_id: order.seller_id,
    /**
     * 30/8/2026 (R127) — La categoria, scritta invece che ereditata.
     *
     * Il valore e' lo stesso che il database metteva da solo, e resta giusto:
     * un reso e' l'aggiornamento di un ordine, e un negoziante che spegne gli
     * avvisi d'ordine sta spegnendo anche questo di sua volonta'. Scriverlo
     * serve a far vedere che e' una scelta: l'avviso di ammanco di cassa,
     * qualche riga piu' in la' nella stessa radiografia, ereditava questa
     * stessa predefinita e li' era sbagliata.
     */
    category: 'order',
    title: '↩️ Nuova richiesta di reso',
    body: `Il cliente ha richiesto il reso per l'ordine #${order.id.slice(0, 8)}`,
    link: `/seller/orders/${order.id}`,
  });

  return NextResponse.json({ id: ret.id, status: 'REQUESTED' }, { status: 201 });
});
