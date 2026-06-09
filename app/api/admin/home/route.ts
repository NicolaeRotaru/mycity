import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import {
  homeSiteSchema, normalizeHomeSite, siteByteSize, MAX_SITE_BYTES, type HomeSite,
} from '@/lib/home-site';
import { sanitizeRichText } from '@/lib/sanitize-html';

export const runtime = 'nodejs';

/**
 * GET/PUT /api/admin/home
 * Home pubblica componibile del marketplace (site_settings.home_site, riga id=1).
 *
 * Difesa in profondità (come /api/seller/site):
 *  - withAdminAuth: solo admin;
 *  - ri-validazione server con homeSiteSchema (forma + limiti anti-abuso);
 *  - SANITIZZAZIONE server-side del testo ricco (valore già sicuro a riposo);
 *  - guard sulla dimensione serializzata;
 *  - scrittura via admin client (service-role); la RLS resta backstop (no write policy).
 */

/** Sanitizza i corpi richText di ogni sezione. */
function sanitizeHome(site: HomeSite): HomeSite {
  return {
    ...site,
    sections: site.sections.map((s) =>
      s.type === 'richText'
        ? { ...s, config: { ...s.config, body: sanitizeRichText(s.config.body) } }
        : s,
    ),
  };
}

export const GET = withAdminAuth(async () => {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('site_settings')
    .select('home_site')
    .eq('id', 1)
    .maybeSingle();
  if (error) return ApiErrors.internal('Impossibile caricare la home');
  // Ritorna la home EFFETTIVA (vuoto => default = layout attuale): l'editor parte da lì.
  return apiSuccess({ site: normalizeHomeSite((data as { home_site?: unknown } | null)?.home_site) });
});

export const PUT = withAdminAuth(async ({ user, req }) => {
  let raw: unknown;
  try {
    const body = await req.json();
    raw = (body as { site?: unknown })?.site ?? body;
  } catch {
    return ApiErrors.invalidRequest('Corpo della richiesta non valido');
  }

  const parsed = homeSiteSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Home non valida');
  }

  const site = sanitizeHome(parsed.data);

  if (siteByteSize(site) > MAX_SITE_BYTES) {
    return ApiErrors.payloadTooLarge('La home è troppo grande. Riduci testi, immagini o sezioni.');
  }

  const admin = getAdminSupabase();
  const { error } = await admin
    .from('site_settings')
    .upsert({ id: 1, home_site: site, updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) return ApiErrors.internal('Impossibile salvare la home');

  return apiSuccess({ site });
});
