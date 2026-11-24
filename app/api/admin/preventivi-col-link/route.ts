import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * I PREVENTIVI COL LINK, PER NICOLA — 24/11/2026.
 *
 * Le attività in «modalità preventivo» (Ora del Gusto) non hanno un accesso: il loro preventivo si
 * apre da un link col codice, che solo il server conosce (tabella preventivi_con_codice, migrazione
 * 708). Qui l'admin legge il link da mandare al titolare (WhatsApp o di persona), lo stato, e se
 * n8n ha già mandato la scheda del locale.
 */
export const GET = withAdminAuth(async () => {
  const admin = getAdminSupabase();
  const [link, schede] = await Promise.all([
    admin.from('preventivi_con_codice').select('seller_id, codice, stato, fascia_scelta, creato_il, accettato_il, profiles!inner(store_name)').order('creato_il', { ascending: false }).limit(200),
    admin.from('schede_clienti').select('id_attivita, aggiornata_il').limit(1000),
  ]);
  if (link.error) {
    logger.error('[admin] preventivi col link non letti', { message: link.error.message });
    return ApiErrors.unavailable('Non riesco a leggere i preventivi col link. Controlla che la migrazione 708 sia applicata.');
  }
  const conScheda = new Map(((schede.data ?? []) as { id_attivita: string; aggiornata_il: string }[]).map((s) => [s.id_attivita, s.aggiornata_il]));
  const righe = (link.data ?? []).map((r) => {
    const riga = r as unknown as { seller_id: string; codice: string; stato: string; fascia_scelta: string | null; creato_il: string; accettato_il: string | null; profiles: { store_name: string | null } | { store_name: string | null }[] };
    const profilo = Array.isArray(riga.profiles) ? riga.profiles[0] : riga.profiles;
    return {
      sellerId: riga.seller_id,
      negozio: profilo?.store_name ?? '',
      stato: riga.stato,
      fascia: riga.fascia_scelta,
      creatoIl: riga.creato_il,
      accettatoIl: riga.accettato_il,
      link: `${env.appUrl()}/preventivo/${riga.codice}`,
      schedaRicevutaIl: conScheda.get(riga.seller_id) ?? null,
    };
  });
  return NextResponse.json({ ok: true, data: righe }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
});
