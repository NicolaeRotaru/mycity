import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { rehostImageUrls } from '@/lib/products/rehostImages';
import { MYCITY_SELLER_ID } from '@/lib/products/mycitySeller';

/**
 * POST /api/products/rehost-images
 * Scarica le immagini importate da un marketplace e le ricarica nel bucket
 * `products` (copie nostre, niente hotlink). Ritorna gli URL ri-ospitati.
 *
 * Disponibile a seller approvati e admin. L'admin può indicare `seller_id`
 * (negozio di destinazione); i seller caricano sempre nella propria cartella.
 */
export const runtime = 'nodejs';

const BodySchema = z.object({
  image_urls: z.array(z.string().url()).max(10),
  seller_id: z.string().uuid().optional(),
});

/** Verifica che il seller esista e sia un venditore (o il negozio MyCity). */
async function isValidSeller(admin: ReturnType<typeof getAdminSupabase>, sellerId: string): Promise<boolean> {
  if (sellerId === MYCITY_SELLER_ID) return true;
  const { data } = await admin.from('profiles').select('role').eq('id', sellerId).single();
  return (data as { role?: string } | null)?.role === 'seller';
}

export const POST = withSellerAuthRateLimit(
  { name: 'rehost-images', max: 20, windowMs: 60_000 },
  async ({ user, profile, req }) => {
    let json: unknown;
    try { json = await req.json(); } catch { return ApiErrors.invalidRequest('Body JSON non valido.'); }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Dati non validi');
    const { image_urls, seller_id } = parsed.data;

    if (image_urls.length === 0) return apiSuccess({ urls: [], failed: [] });

    const admin = getAdminSupabase();

    // Cartella di destinazione: solo l'admin può ri-ospitare per un altro
    // negozio; i seller usano sempre la propria. Un seller_id valorizzato da un
    // non-admin viene ignorato (cade su user.id).
    let ownerId = user.id;
    if (seller_id && profile.role === 'admin') {
      if (!(await isValidSeller(admin, seller_id))) {
        return ApiErrors.invalidRequest('Negozio di destinazione non valido');
      }
      ownerId = seller_id;
    }

    try {
      const result = await rehostImageUrls(admin, ownerId, image_urls);
      return apiSuccess(result);
    } catch (err) {
      logger.error('Errore ri-ospitando le immagini', {
        feature: 'rehost-images',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return ApiErrors.badGateway('Errore durante la copia delle foto. Riprova.');
    }
  },
);
