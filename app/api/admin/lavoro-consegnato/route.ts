import { withAdminAuth } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { lavoroConsegnatoDi, negoziConLavoroConsegnato } from '@/lib/agenzia/lavoro-consegnato/registro';
import type { NegozioConLavoro } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * IL LAVORO DEI CLIENTI, VISTO DA ADMIN — 27/11/2026.
 *
 * Nicola: «dammi modo di accedere all'account Caffè di Piacenza». L'account del Caffè ha ancora l'email di
 * sistema finché il titolare non conferma il link: nessuno ci può entrare. Scelta di Nicola: «vederlo da Admin».
 * Qui l'amministratore legge, per ogni negozio del registro, quello che il negozio vede nelle voci «Sito web»,
 * «Gestione social» e «Analisi del business». Solo lettura, solo admin: l'account del cliente non si tocca.
 */
export const GET = withAdminAuth(async () => {
  const ids = negoziConLavoroConsegnato();
  const nomi = new Map<string, string>();
  try {
    const { data, error } = await getAdminSupabase().from('profiles').select('id, store_name').in('id', ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; store_name: string | null }>) if (r.store_name) nomi.set(r.id, r.store_name);
  } catch (e) {
    // Senza i nomi la pagina resta utile: mostra l'id del negozio al posto del nome.
    logger.warn('[admin/lavoro-consegnato] nomi dei negozi non letti', { errore: String(e) });
  }
  const negozi: NegozioConLavoro[] = [];
  for (const id of ids) {
    const lavoro = lavoroConsegnatoDi(id);
    if (lavoro) negozi.push({ negozioId: id, nome: nomi.get(id) ?? id, lavoro });
  }
  return apiSuccess({ negozi }, { headers: { 'Cache-Control': 'no-store' } });
});
