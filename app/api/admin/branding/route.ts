import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { brandingSchema, normalizeBranding } from '@/lib/site-branding';

export const runtime = 'nodejs';

/**
 * GET/PUT /api/admin/branding
 * Branding globale del marketplace (site_settings.branding, riga id=1).
 * Solo admin (withAdminAuth); validazione server (brandingSchema); scrittura via
 * service-role (RLS backstop, nessuna write policy). Mirror di /api/admin/home.
 */

export const GET = withAdminAuth(async () => {
  const admin = getAdminSupabase();
  const { data, error } = await admin.from('site_settings').select('branding').eq('id', 1).maybeSingle();
  if (error) return ApiErrors.internal('Impossibile caricare il branding');
  return apiSuccess({ branding: normalizeBranding((data as { branding?: unknown } | null)?.branding) });
});

export const PUT = withAdminAuth(async ({ user, req }) => {
  let raw: unknown;
  try {
    const body = await req.json();
    raw = (body as { branding?: unknown })?.branding ?? body;
  } catch {
    return ApiErrors.invalidRequest('Corpo della richiesta non valido');
  }

  const parsed = brandingSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.invalidRequest(parsed.error.issues[0]?.message ?? 'Branding non valido');
  }

  const admin = getAdminSupabase();
  const { error } = await admin
    .from('site_settings')
    .upsert({ id: 1, branding: parsed.data, updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) return ApiErrors.internal('Impossibile salvare il branding');

  return apiSuccess({ branding: parsed.data });
});
