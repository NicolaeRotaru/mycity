import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

const Body = z.object({
  riderId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data attesa in formato YYYY-MM-DD'),
});

/**
 * Admin: conferma la rimessa contanti di un rider per una data → rilascia i
 * payout COD di quel giorno (AWAITING_REMITTANCE → HELD). 🔴-1 settlement COD, slice 2.
 *
 * Chiama l'RPC via il client UTENTE (getServerSupabase): la guardia is_admin()
 * dentro la funzione SECURITY DEFINER legge auth.uid() dal JWT dell'admin, quindi
 * la protezione vive nel DB (non aggirabile via PostgREST diretto). withAdminAuth
 * è la prima barriera applicativa.
 */
export const POST = withAdminAuth(async ({ req }): Promise<NextResponse> => {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data, error } = await supa.rpc('confirm_cod_remittance', {
    p_rider: body.riderId,
    p_date: body.date,
  });
  if (error) {
    logger.error('[admin] confirm_cod_remittance fallita', { error: error.message });
    return ApiErrors.internal('Conferma rimessa fallita');
  }

  // 22/8/2026 — la funzione risponde con due numeri invece di uno: quelli
  // rilasciati e quelli SALTATI perche' l'incasso non era stato registrato. I
  // saltati vanno visti: sono contante di cui non esiste traccia.
  const esito = (data ?? {}) as { rilasciati?: number; saltati_senza_incasso?: number } | number;
  const rilasciati = typeof esito === 'number' ? esito : esito.rilasciati ?? 0;
  const saltati = typeof esito === 'number' ? 0 : esito.saltati_senza_incasso ?? 0;

  return NextResponse.json({ ok: true, released: rilasciati, saltatiSenzaIncasso: saltati }, { status: 200 });
});
