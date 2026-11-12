import { withAdminAuth } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { checkTitolare } from '@/lib/health/titolare-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/configurazione — 12/11/2026 (R06-023).
 *
 * La pagina pubblica «Stato servizi» non dice piu' a tutti quali variabili
 * mancano (era un messaggio per lo sviluppatore). Il dettaglio serve pero' a chi
 * amministra: la chiave di servizio c'e'? I dati del titolare sono completi?
 * Solo admin (withAdminAuth). Non espone nessun valore, solo «c'e' / manca» e i
 * NOMI dei dati mancanti.
 */
export const GET = withAdminAuth(async () => {
  const titolare = checkTitolare();
  return apiSuccess({
    chiaveDiServizio: Boolean(env.supabaseServiceRoleKey()),
    titolareCompleto: titolare.status === 'operational',
    titolareMancanti: titolare.detail,
  });
});
