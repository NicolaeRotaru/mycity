import { AiConfigError } from '@/lib/ai/client';
import { AiCallError, mapAiError } from '@/lib/ai/run';
import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit';
import { resolveAiPatch, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';
import { classifyProductPolicy } from '@/lib/ai/moderation';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

/**
 * Applica al prodotto un patch confermato dal venditore nella chat Assistenza.
 *
 * Separato dalla chat (/api/ai/catalog-chat) di proposito: la chat PROPONE, qui
 * si SCRIVE — ma solo dopo che il venditore ha premuto "Applica" sulla card di
 * riepilogo (human-in-the-loop). La risoluzione del patch è server-side e
 * validata (lib/products/aiPatch); la scrittura è sempre vincolata a
 * seller_id = utente (anche admin scrive solo prodotti propri qui).
 */

export const runtime = 'nodejs';

type ApplyBody = { productId?: string; patch?: AiProductPatch };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-apply:${user.id}`, max: 60, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: ApplyBody;
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const productId = typeof body.productId === 'string' ? body.productId : '';
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
  if (!productId) return ApiErrors.invalidRequest('Prodotto mancante.');
  if (!patch) return ApiErrors.invalidRequest('Nessuna modifica da applicare.');

  const admin = getAdminSupabase();

  const [{ data: row }, { data: categoriesData }] = await Promise.all([
    admin.from('products').select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`).eq('id', productId).single(),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  if (!row) return ApiErrors.notFound('Prodotto non trovato.');
  if ((row as { seller_id?: string }).seller_id !== user.id) {
    return ApiErrors.forbidden('Non puoi modificare un prodotto che non è tuo.');
  }

  const categories = (categoriesData ?? []) as CategoryRow[];
  const current = row as unknown as ProductRow;

  const { update, changed } = resolveAiPatch({
    patch,
    current: {
      attributes: current.attributes ?? null,
      category_id: current.category_id,
      has_variants: current.has_variants,
      // 22/8/2026 — IL FRENO SUL PREZZO ESISTE, E' PROVATO, E NON SI ACCENDEVA MAI.
      //
      // `resolveAiPatch` rifiuta un prezzo che si scosta di piu' del 30% da
      // quello attuale. Ma il prezzo attuale non gli arrivava: questo oggetto
      // non lo conteneva, quindi dentro la funzione valeva zero, e con zero il
      // confronto «scostamento oltre il 30%» non scatta mai. Il freno era
      // scritto, coperto da una prova sulla libreria, e in produzione inerte.
      //
      // La prova che c'era non poteva accorgersene: chiamava la libreria
      // passandole il prezzo. Quella nuova (tests/unit) chiama la ROTTA, che e'
      // il punto in cui il difetto viveva.
      price: current.price,
    },
    categories,
  });

  if (Object.keys(update).length === 0) {
    return ApiErrors.invalidRequest('Nessuna modifica valida da applicare.');
  }

  // #5 — Il cancello sui prodotti vietati c'era sulla rotta che li crea, e
  // mancava qui, dove una scheda già pubblicata viene RISCRITTA. Un prodotto
  // ammesso alla nascita e trasformato dopo in qualcos'altro passava senza
  // controlli: un filtro che si può aggirare cambiando strada non è un filtro.
  // Si controlla solo se la modifica tocca nome o descrizione, cioè quello che
  // il filtro guarda: sul prezzo o sulla scorta non ha niente da dire.
  const nome = typeof update.name === 'string' ? update.name : (current.name ?? '');
  const descrizione =
    typeof update.description === 'string' ? update.description : (current.description ?? '');
  try {
    if (typeof update.name === 'string' || typeof update.description === 'string') {
      const verdetto = await classifyProductPolicy(
        { name: nome, description: descrizione },
        'catalog-apply-policy',
      );
      if (!verdetto.allowed) {
        return ApiErrors.invalidRequest(`Questa modifica non si puo' pubblicare: ${verdetto.reason}`);
      }
    }
  } catch (err) {
    // 22/8/2026 — IL FILTRO E' UNA CHIAMATA AL MODELLO COME LE ALTRE.
    // Se quella cade — modello giu', chiave scaduta, rete — qui non c'era
    // nessuna rete di protezione: l'eccezione usciva grezza e al venditore
    // arrivava un 500 muto mentre stava applicando una modifica. Adesso riceve
    // lo stesso messaggio leggibile che riceverebbe se fosse caduta la
    // generazione.
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-catalog-apply-policy');
    return ApiErrors.internal('Errore AI.');
  }

  const { data: updated, error } = await admin
    .from('products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', user.id)
    .select(PRODUCT_SNAPSHOT_COLS)
    .single();

  if (error || !updated) {
    logger.error('catalog-apply update failed', { productId, status: error?.code });
    return ApiErrors.badGateway('Non sono riuscito a salvare. Riprova.');
  }

  // #196 — Chi ha scritto cosa. Le modifiche fatte dall'AI non lasciavano
  // nessuna traccia: non si sapeva quale prodotto fosse stato toccato da un
  // suggerimento accettato, ne' cosa c'era scritto prima. Se un prezzo o una
  // descrizione uscivano sbagliati, non c'era modo di risalire — ne' di
  // annullare. Qui si registra chi, cosa, e il valore precedente dei soli
  // campi cambiati. Best-effort: non blocca la risposta.
  const prima: Record<string, unknown> = {};
  for (const campo of Object.keys(update)) prima[campo] = (current as Record<string, unknown>)[campo];
  void writeAudit({
    actorId: user.id,
    action: 'product.update',
    targetTable: 'products',
    targetId: productId,
    metadata: { origine: 'ai-copilot', campi: Object.keys(update), prima, dopo: update },
  });

  return NextResponse.json({
    ok: true,
    changed,
    product: productSnapshot(updated as unknown as ProductRow, categories),
  });
});
