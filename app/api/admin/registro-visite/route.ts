import { withAdminAuth } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { statoDellaRegistrazione } from '@/lib/activity';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/registro-visite — il registro delle visite sta salvando?
 *
 * La pagina Attività leggeva solo `activity_events`: con la chiave di servizio
 * assente /api/track non salva niente, e la pagina diceva «0 visitatori» come
 * se non entrasse nessuno. Qui si dice se la registrazione è configurata, così
 * la pagina può scrivere «registro spento» invece di uno zero.
 * Solo admin (withAdminAuth): non espone valori, solo «c'è / non c'è».
 */
export const GET = withAdminAuth(async () => {
  const stato = statoDellaRegistrazione();
  const chiave = Boolean(env.supabaseServiceRoleKey());
  return apiSuccess({ acceso: chiave && !stato.spenta, dalle: stato.spenta ? stato.dalle : null });
});
