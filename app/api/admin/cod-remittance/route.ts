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
  // 15/11/2026 (R26-019) — gli ordini che la pagina mostrava quando l'admin ha
  // contato i contanti: la conferma rilascia solo quelli.
  orderIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
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
  /**
   * 15/11/2026 (R26-019) — SI SBLOCCANO SOLO GLI INCASSI CHE L'ADMIN HA VISTO.
   *
   * Con (fattorino, giorno) la funzione rendeva pagabili anche gli ordini
   * chiusi DOPO che la pagina era stata aperta: contanti che nessuno ha contato.
   * Con l'elenco degli ordini mostrati (migrazione 501) si rilasciano solo
   * quelli. Finche' la 501 non e' applicata si ripiega sulla forma vecchia,
   * scritto forte: i negozi non devono restare senza pagamento nell'attesa.
   */
  let { data, error } = body.orderIds
    ? await supa.rpc('confirm_cod_remittance', {
        p_rider: body.riderId,
        p_date: body.date,
        p_order_ids: body.orderIds,
      })
    : await supa.rpc('confirm_cod_remittance', {
        p_rider: body.riderId,
        p_date: body.date,
      });
  const codice = (error as { code?: unknown } | null)?.code;
  if (body.orderIds && (codice === 'PGRST202' || codice === '42883')) {
    logger.error('[admin] conferma rimessa con gli ordini visti non disponibile (migrazione 501 da applicare): uso la forma per giorno', {
      riderId: body.riderId, giorno: body.date,
    });
    ({ data, error } = await supa.rpc('confirm_cod_remittance', {
      p_rider: body.riderId,
      p_date: body.date,
    }));
  }
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
      ordini_visti: body.orderIds?.length ?? null,
    },
  });

  return NextResponse.json({ ok: true, released: rilasciati, saltatiSenzaIncasso: saltati }, { status: 200 });
});
