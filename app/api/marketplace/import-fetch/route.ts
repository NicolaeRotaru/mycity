import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { AiConfigError } from '@/lib/ai/client';
import { AiCallError } from '@/lib/ai/run';
import { fetchExternalSnapshot, resolveCategoryFromSlug } from '@/lib/products/externalSync';

/**
 * POST /api/marketplace/import-fetch
 * Import da link/nome di un prodotto marketplace (Amazon/eBay/…): Claude +
 * web_search recuperano i dati identici (nome, descrizione, prezzo, immagini,
 * attributi, tempo di consegna). Disponibile a seller approvati e admin.
 * Non scrive nulla: restituisce i dati per pre-compilare il form prodotto.
 */
export const runtime = 'nodejs';

const BodySchema = z.object({
  query: z.string().trim().min(3, 'Inserisci un link o un nome prodotto').max(2000),
  marketplace: z.enum(['ebay', 'amazon', 'aliexpress', 'other']).optional(),
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato sul server.');

  // Rate limit aggressivo: ogni chiamata usa Sonnet + web_search.
  const rl = await rateLimitAsync({ key: `import-fetch:${user.id}`, max: 15, windowMs: 5 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido.'); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
  const { query, marketplace } = parsed.data;

  try {
    const extract = await fetchExternalSnapshot(query, marketplace);
    if (!extract.name) return ApiErrors.badGateway('Non sono riuscito a riconoscere il prodotto. Prova con il link diretto.');

    const { categoryId, subcategoryId } = await resolveCategoryFromSlug(extract.category_slug, extract.subcategory);

    return apiSuccess({
      name: extract.name,
      description: extract.description,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      category_slug: extract.category_slug,
      suggested_price: extract.price,
      currency: extract.currency,
      image_urls: extract.image_urls,
      attributes: extract.attributes,
      tags: extract.tags,
      external: {
        marketplace: marketplace ?? extract.marketplace ?? 'other',
        source_url: extract.source_url ?? (/^https?:\/\//i.test(query) ? query : null),
        ...extract.external,
      },
      confidence: extract.confidence,
    });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('API key Anthropic non valida.');
    const status = err instanceof AiCallError ? err.status : undefined;
    logger.error('Errore import marketplace', { feature: 'marketplace-import', status });
    if (status === 401) return ApiErrors.unavailable('API key Anthropic non valida.');
    if (status === 429) return ApiErrors.rateLimited(60);
    return ApiErrors.badGateway('Errore nel servizio AI. Riprova.');
  }
});
