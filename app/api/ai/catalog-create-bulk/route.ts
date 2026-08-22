import { jsonRichiesta, TETTO_JSON_CON_FOTO } from '@/lib/api/corpo';
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
 * Crea PIÙ prodotti (BOZZE) in un colpo solo dalle foto, dopo che il venditore
 * ha rivisto la lista proposta da /api/vision/extract-products. Gemello massivo
 * di /api/ai/catalog-create: stessa validazione per-prodotto (sorgente unica
 * buildDraftProductInsert), ma un solo insert in batch. Nasce tutto come
 * 'draft': autonomo nell'inserimento, non pubblico finché il venditore non
 * pubblica. Scrittura sempre vincolata a seller_id = utente.
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
  items: z
    .array(
      z.object({
        imageUrls: z.array(z.string().url()).min(1).max(8),
        draft: DraftSchema,
      }),
    )
    .min(1)
    .max(12),
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // Ogni call crea fino a 12 prodotti: rate limit per evitare flood.
  const rl = await rateLimitAsync({ key: `ai-catalog-create-bulk:${user.id}`, max: 10, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try {
    json = await jsonRichiesta(req, TETTO_JSON_CON_FOTO);
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Dati prodotti non validi.');

  const admin = getAdminSupabase();
  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  // #197 — Ogni prodotto passa dal filtro dei prodotti vietati PRIMA di
  // entrare nel catalogo, uno per uno, e chi non passa viene scartato con il
  // motivo. Prima il filtro esisteva solo sull'endpoint che non scrive.
  // #205 — E le foto devono stare sul nostro Storage.
  const scartati: Array<{ nome: string; motivo: string }> = [];
  const payloads: NonNullable<ReturnType<typeof buildDraftProductInsert>>[] = [];

  const nomeDi = (item: (typeof parsed.data.items)[number]) =>
    String(item.draft.name ?? 'senza nome');

  // Prima passata, senza rete: chi non ha foto sul nostro Storage esce subito.
  const daControllare: Array<{
    item: (typeof parsed.data.items)[number];
    imageUrls: string[];
  }> = [];
  for (const item of parsed.data.items) {
    const imageUrls = item.imageUrls.filter((u) => fotoDaHostAmmesso(u));
    if (imageUrls.length === 0) {
      scartati.push({ nome: nomeDi(item), motivo: 'foto non caricate su MyCity' });
      continue;
    }
    daControllare.push({ item, imageUrls });
  }

  // 22/8/2026 — I DODICI CONTROLLI PARTIVANO IN FILA INDIANA.
  //
  // Ogni prodotto passa dal filtro dei prodotti vietati prima di entrare nel
  // catalogo, e ogni filtro e' un'andata e ritorno verso il modello. Erano in
  // fila: il secondo partiva quando il primo era tornato. Con dodici prodotti
  // — il massimo che la richiesta accetta — sono dodici attese sommate, e nel
  // caso peggiore la richiesta scade prima di aver scritto qualsiasi cosa. Il
  // venditore vede girare la rotellina e poi un errore.
  //
  // Adesso partono tutti insieme e si aspetta l'ultimo, non la somma. Dodici
  // attese in parallelo sono una attesa sola.
  //
  // `allSettled` e non `all`: il filtro che cade su un prodotto non deve far
  // cadere gli altri undici. Quel prodotto finisce fra gli scartati col motivo
  // scritto, e non entra: nel dubbio si nega, come fa il filtro stesso quando
  // risponde.
  const verdetti = await Promise.allSettled(
    daControllare.map(({ item }) =>
      classifyProductPolicy(
        {
          name: String(item.draft.name ?? ''),
          description: String(item.draft.description ?? ''),
          categorySlug: item.draft.category_slug ?? undefined,
        },
        'catalog-create-bulk-policy',
      ),
    ),
  );

  // L'ordine di `verdetti` e' quello di `daControllare`: allSettled lo tiene.
  daControllare.forEach(({ item, imageUrls }, i) => {
    const esito = verdetti[i];
    if (esito.status === 'rejected') {
      scartati.push({
        nome: nomeDi(item),
        motivo: 'controllo non disponibile in questo momento: riprova fra poco',
      });
      return;
    }
    if (!esito.value.allowed) {
      scartati.push({ nome: nomeDi(item), motivo: esito.value.reason });
      return;
    }
    payloads.push(
      buildDraftProductInsert({ draft: item.draft, imageUrls, categories, sellerId: user.id }),
    );
  });

  if (payloads.length === 0) {
    const motivi = scartati.map((s2) => `${s2.nome}: ${s2.motivo}`).join(' · ');
    return ApiErrors.invalidRequest(
      motivi ? `Nessun prodotto pubblicabile. ${motivi}` : 'Nessun prodotto con foto valide da creare.',
    );
  }

  const { data: created, error } = await admin
    .from('products')
    .insert(payloads)
    .select(PRODUCT_SNAPSHOT_COLS);

  if (error || !created) {
    logger.error('catalog-create-bulk insert failed', {
      sellerId: user.id,
      count: payloads.length,
      status: error?.code,
    });
    return ApiErrors.badGateway('Non sono riuscito a creare i prodotti. Riprova.');
  }

  // #196 — Chi ha scritto cosa. Le modifiche fatte dall'AI non lasciavano
  // nessuna traccia: non si sapeva quale prodotto fosse stato toccato da un
  // suggerimento accettato, ne' cosa c'era scritto prima. Se un prezzo o una
  // descrizione uscivano sbagliati, non c'era modo di risalire — ne' di
  // annullare. Qui si registra chi, cosa, e il valore precedente dei soli
  // campi cambiati. Best-effort: non blocca la risposta.
  for (const riga of created as unknown as ProductRow[]) {
    void writeAudit({
      actorId: user.id,
      action: 'product.create',
      targetTable: 'products',
      targetId: riga.id,
      metadata: { origine: 'vision-create-bulk', dopo: { name: riga.name, price: riga.price } },
    });
  }

  return NextResponse.json({
    ok: true,
    count: created.length,
    // #197 — Chi e' stato scartato e perche': senza questo il venditore carica
    // dodici foto, ne vede nascere dieci e non sa quali due mancano.
    scartati,
    products: (created as unknown as ProductRow[]).map((row) => productSnapshot(row, categories)),
  });
});
