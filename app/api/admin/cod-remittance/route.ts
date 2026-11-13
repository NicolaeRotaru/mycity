import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { aggiornaQuadratura } from '@/lib/cassa/quadratura';
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
  const esito = (data ?? {}) as
    | { rilasciati?: number; saltati_senza_incasso?: number; versata_ora?: boolean }
    | number;
  const rilasciati = typeof esito === 'number' ? esito : esito.rilasciati ?? 0;
  const saltati = typeof esito === 'number' ? 0 : esito.saltati_senza_incasso ?? 0;
  // 13/11/2026 (R14-006) — Una rimessa e' registrata se questa conferma ha
  // rilasciato degli ordini o ha chiuso la giornata (`versata_ora`, migrazione
  // 383). Il doppio clic manda una seconda conferma uguale: in fila dietro la
  // prima (lucchetto della 381) non rilascia niente e non chiude niente, e prima
  // lasciava lo stesso una seconda riga «rimessa confermata» nel registro delle
  // azioni. Adesso quella conferma risponde e basta, senza registrare una rimessa.
  const registrata = rilasciati > 0 || (typeof esito === 'object' && esito.versata_ora === true);

  // 13/11/2026 (R14-002) — La giornata di cassa si ricalcola subito dopo la
  // rimessa. Se la rimessa la lascia aperta (resta un ordine da versare, migrazione
  // 381), la guardia della cancellazione e il sorvegliante la riconoscono come
  // aperta solo dall'incassato o dal MISMATCH: prima restavano quelli dell'ultimo
  // ricalcolo, che non conta l'ultima consegna chiusa dopo l'incasso, fino al giro
  // notturno. Il «versato» non si tocca qui: lo decide la funzione nel database.
  // La rimessa e' gia' fatta: un ricalcolo che non riesce si scrive e si va avanti
  // (il giro notturno riquadra-casse rifa' ieri e oggi).
  try {
    await aggiornaQuadratura(getAdminSupabase(), body.riderId, body.date);
  } catch (e) {
    logger.error('[admin] quadratura della giornata non aggiornata dopo la rimessa', {
      riderId: body.riderId,
      giorno: body.date,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!registrata) {
    return NextResponse.json(
      { ok: true, released: 0, saltatiSenzaIncasso: saltati, registrata: false },
      { status: 200 },
    );
  }

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

  return NextResponse.json({ ok: true, released: rilasciati, saltatiSenzaIncasso: saltati, registrata: true }, { status: 200 });
});
