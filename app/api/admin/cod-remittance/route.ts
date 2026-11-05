import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const Body = z.object({
  riderId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data attesa in formato YYYY-MM-DD'),
  // 5/11/2026 (S05) — quanto contante l'admin ha contato davvero, e perché è
  // diverso dall'atteso. Restano nel registro delle azioni.
  contatiCents: z.number().int().min(0).max(10_000_000).optional(),
  attesiCents: z.number().int().min(0).max(10_000_000).optional(),
  nota: z.string().trim().max(500).optional(),
}).refine(
  (b) => b.contatiCents === undefined || b.attesiCents === undefined || b.contatiCents === b.attesiCents || Boolean(b.nota),
  { message: 'I contanti contati sono diversi dall’atteso: scrivi una nota', path: ['nota'] },
);

/**
 * Admin: conferma la rimessa contanti di un rider per una data → rilascia i
 * payout COD di quel giorno (AWAITING_REMITTANCE → HELD). 🔴-1 settlement COD, slice 2.
 *
 * Chiama l'RPC via il client UTENTE (getServerSupabase): la guardia is_admin()
 * dentro la funzione SECURITY DEFINER legge auth.uid() dal JWT dell'admin, quindi
 * la protezione vive nel DB (non aggirabile via PostgREST diretto). withAdminAuth
 * è la prima barriera applicativa.
 */
export const POST = withAdminAuth(async ({ req, user }): Promise<NextResponse> => {
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

  await writeAudit({
    actorId: user.id,
    action: 'cod.remittance_confirm',
    targetTable: 'profiles',
    targetId: body.riderId,
    metadata: {
      giorno: body.date,
      rilasciati,
      saltati,
      contati_cents: body.contatiCents ?? null,
      attesi_cents: body.attesiCents ?? null,
      nota: body.nota ?? null,
    },
  });

  return NextResponse.json({ ok: true, released: rilasciati, saltatiSenzaIncasso: saltati }, { status: 200 });
});
