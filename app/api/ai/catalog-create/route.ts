import { AiConfigError } from '@/lib/ai/client';
import { AiCallError, mapAiError } from '@/lib/ai/run';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { classifyProductPolicy } from '@/lib/ai/moderation';
import { fotoDaHostAmmesso } from '@/lib/ai/productContext';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import type { CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';

/**
 * Crea un nuovo prodotto (BOZZA) dalle sole foto: l'estrazione AI dei campi è
 * già stata fatta dal client via /api/vision/extract-product; qui validiamo la
 * bozza e la INSERIamo come prodotto del venditore con le foto come immagini.
 *
 * Nasce come 'draft' di proposito: l'inserimento è autonomo (l'AI compila
 * tutto), ma la bozza NON è pubblica finché il venditore non la pubblica — può
 * rivederla e pubblicarla dalla stessa chat o dall'editor. Le immagini e la
 * categoria sono validate/risolte server-side; la scrittura è vincolata a
 * seller_id = utente.
 */

export const runtime = 'nodejs';

const DraftSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  category_id: z.string().uuid().nullable().optional(),
  subcategory_id: z.string().uuid().nullable().optional(),
  category_slug: z.string().optional(),
  suggested_price: z.number().nullable().optional(),
  attributes: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  alt_text: z.string().nullable().optional(),
});

const BodySchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(8),
  draft: DraftSchema,
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-create:${user.id}`, max: 30, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try {
    json = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    // (R153) Troppo grande e malformato non sono la stessa cosa: il perche' e'
    // scritto per esteso in app/api/ai/catalog-chat/route.ts.
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Dati prodotto non validi.');

  // #205 — Solo foto ospitate da noi: un indirizzo qualunque puo' cambiare
  // contenuto dopo la pubblicazione, e intanto vede il traffico dei clienti.
  const imageUrls = parsed.data.imageUrls.filter((u) => fotoDaHostAmmesso(u)).slice(0, 4);
  if (imageUrls.length === 0) return ApiErrors.invalidRequest('Le foto devono essere caricate su MyCity.');
  const draft = parsed.data.draft;

  // #197 — Il controllo sui prodotti vietati stava sull'endpoint che NON
  // scrive (vision/extract-product) e mancava proprio qui, dove il prodotto
  // entra nel catalogo. Chi chiamava questa rotta direttamente saltava il
  // filtro: un controllo che si puo' aggirare non e' un controllo. Rifarlo qui
  // costa una chiamata da 128 token, e nega in caso di dubbio.
  try {
    const verdetto = await classifyProductPolicy({
      name: String(draft.name ?? ''),
      description: String(draft.description ?? ''),
      categorySlug: draft.category_slug ?? undefined,
    }, 'catalog-create-policy');
    if (!verdetto.allowed) {
      return ApiErrors.invalidRequest(`Questo prodotto non si puo' pubblicare: ${verdetto.reason}`);
    }
  } catch (err) {
    // 22/8/2026 — IL FILTRO E' UNA CHIAMATA AL MODELLO COME LE ALTRE.
    // Se quella cade — modello giu', chiave scaduta, rete — qui non c'era
    // nessuna rete di protezione: l'eccezione usciva grezza e al venditore
    // arrivava un 500 muto mentre stava applicando una modifica. Adesso riceve
    // lo stesso messaggio leggibile che riceverebbe se fosse caduta la
    // generazione.
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, 'ai-catalog-create-policy');
    return ApiErrors.internal('Errore AI.');
  }

  const admin = getAdminSupabase();
  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  // Categoria, attributi, condizione, tag, prezzo: risolti e validati dalla
  // sorgente unica condivisa con la creazione multi-prodotto. Mai fidarsi
  // ciecamente del client.
  const payload = buildDraftProductInsert({ draft, imageUrls, categories, sellerId: user.id });

  const { data: created, error } = await admin
    .from('products')
    .insert(payload)
    .select(PRODUCT_SNAPSHOT_COLS)
    .single();

  if (error || !created) {
    logger.error('catalog-create insert failed', { sellerId: user.id, status: error?.code });
    return ApiErrors.badGateway('Non sono riuscito a creare il prodotto. Riprova.');
  }

  // #196 — Chi ha scritto cosa. Le modifiche fatte dall'AI non lasciavano
  // nessuna traccia: non si sapeva quale prodotto fosse stato toccato da un
  // suggerimento accettato, ne' cosa c'era scritto prima. Se un prezzo o una
  // descrizione uscivano sbagliati, non c'era modo di risalire — ne' di
  // annullare. Qui si registra chi, cosa, e il valore precedente dei soli
  // campi cambiati. Best-effort: non blocca la risposta.
  void writeAudit({
    actorId: user.id,
    action: 'product.create',
    targetTable: 'products',
    targetId: (created as { id?: string }).id,
    metadata: { origine: 'vision-create', dopo: { name: payload.name, price: payload.price } },
  });

  return NextResponse.json({
    ok: true,
    product: productSnapshot(created as unknown as ProductRow, categories),
  });
});
