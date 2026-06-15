import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimitAsync } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { getBgRemovalProvider } from '@/lib/bg-removal';
import {
  BgRemovalConfigError,
  BgRemovalRateLimitError,
  BgRemovalUpstreamError,
  type BgRemovalProvider,
} from '@/lib/bg-removal/types';

/**
 * Rimozione sfondo foto prodotto → soggetto su BIANCO uniforme.
 *
 * Pensato per i venditori che fotografano i prodotti su superfici non idonee:
 * la foto viene scontornata lato server (provider a pagamento) e restituita su
 * sfondo bianco "professionale". Stesso impianto del vision route:
 * solo seller approvati, rate limit (ogni chiamata costa), validazione base64.
 */

// Eseguito sempre lato server (provider key server-only).
export const runtime = 'nodejs';

// Validazione base64 (solo charset), come app/api/vision/extract-product/route.ts.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const BodySchema = z.object({
  image_base64: z.string().min(1),
  media_type: z.enum(MEDIA_TYPES),
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // 1) Config provider PRIMA del rate limit (come vision controlla anthropicKey).
  //    Provider non configurato (o 'mock' in prod) → 503, senza spendere un token.
  let provider: BgRemovalProvider;
  try {
    provider = getBgRemovalProvider();
  } catch (err) {
    if (err instanceof BgRemovalConfigError) {
      return ApiErrors.unavailable('Servizio rimozione sfondo non configurato sul server.');
    }
    throw err;
  }

  // 2) Rate limit: 15 chiamate / 5 min per utente (ogni rimozione ha un costo).
  const rl = await rateLimitAsync({ key: `bg-remove:${user.id}`, max: 15, windowMs: 5 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  // 3) Body + validazione
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ApiErrors.invalidRequest('Body JSON non valido.');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return ApiErrors.invalidRequest('media_type deve essere image/jpeg, image/png o image/webp.');
  }
  const { image_base64, media_type } = parsed.data;

  if (!BASE64_RE.test(image_base64.slice(0, 4096))) {
    return ApiErrors.invalidRequest('image_base64 non è un valore base64 valido.');
  }
  // base64 ~= 4/3 byte raw: accettiamo fino a ~5 MB raw = ~7 MB base64.
  if (image_base64.length > 7_500_000) {
    return ApiErrors.payloadTooLarge('Immagine troppo grande. Massimo 5 MB.');
  }

  // 4) Rimozione sfondo → immagine su bianco
  try {
    const result = await provider.removeBackground({ base64: image_base64, mediaType: media_type });
    return NextResponse.json({ image_base64: result.base64, media_type: result.mediaType });
  } catch (err) {
    if (err instanceof BgRemovalConfigError) {
      return ApiErrors.unavailable('Servizio rimozione sfondo non disponibile al momento.');
    }
    if (err instanceof BgRemovalRateLimitError) {
      return ApiErrors.rateLimited(60);
    }
    // Log solo lo status, mai il body (puo' contenere frammenti di chiave/input).
    const status = err instanceof BgRemovalUpstreamError ? err.status : undefined;
    logger.error('Errore rimozione sfondo', { feature: 'bg-remove', status });
    return ApiErrors.badGateway('Errore nel servizio di rimozione sfondo. Riprova.');
  }
});
