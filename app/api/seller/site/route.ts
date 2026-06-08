import { type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { storeSiteSchema, siteByteSize, MAX_SITE_BYTES, type StoreSite } from '@/lib/store-site';
import { sanitizeRichText } from '@/lib/sanitize-html';

export const runtime = 'nodejs';

/**
 * PUT /api/seller/site
 * Salva il sito vetrina multi-pagina del venditore (profiles.store_site).
 *
 * Difesa in profondità rispetto all'update diretto via RLS:
 *  - withSellerAuth: solo seller approvati o admin;
 *  - ri-validazione server con storeSiteSchema (forma + limiti anti-abuso);
 *  - SANITIZZAZIONE server-side del testo ricco (punto canonico, valore già sicuro
 *    a riposo);
 *  - guard sulla dimensione serializzata;
 *  - scrittura via admin client scoped a user.id (RLS resta comunque come backstop).
 */

/** Sanitizza i corpi richText di ogni sezione di ogni pagina. */
function sanitizeSite(site: StoreSite): StoreSite {
  return {
    ...site,
    pages: site.pages.map((p) => ({
      ...p,
      sections: p.sections.map((s) =>
        s.type === 'richText'
          ? { ...s, config: { ...s.config, body: sanitizeRichText(s.config.body) } }
          : s,
      ),
    })),
  };
}

export const PUT = withSellerAuth(async ({ user, req }) => {
  let raw: unknown;
  try {
    const body = await req.json();
    raw = (body as { site?: unknown })?.site ?? body;
  } catch {
    return ApiErrors.invalidRequest('Corpo della richiesta non valido');
  }

  const parsed = storeSiteSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Sito non valido');
  }

  const site = sanitizeSite(parsed.data);

  if (siteByteSize(site) > MAX_SITE_BYTES) {
    return ApiErrors.payloadTooLarge('Il sito è troppo grande. Riduci testi, immagini o sezioni.');
  }

  const admin = getAdminSupabase();
  const { error } = await admin.from('profiles').update({ store_site: site }).eq('id', user.id);
  if (error) return ApiErrors.internal('Impossibile salvare il sito');

  return apiSuccess({ site });
});
