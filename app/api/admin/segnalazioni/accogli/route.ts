import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * 12/11/2026 (R02-003) — ACCOGLIERE UNA SEGNALAZIONE SU UN PRODOTTO LO TOGLIE DAVVERO.
 *
 * «Accolta (il contenuto va tolto)» aggiornava solo la riga della segnalazione: il prodotto
 * restava in vetrina, e intanto a chi aveva segnalato e al venditore partiva «il contenuto è
 * stato rimosso». Adesso la pagina passa di qui PRIMA di registrare la decisione: il prodotto
 * va in bozza (fuori dalla vetrina: si vede solo con status 'available'), l'azione finisce nel
 * registro, e solo se la scrittura è riuscita la decisione e il suo esito partono.
 */
const Corpo = z.object({ id: z.string().uuid() });

export const POST = withAdminAuth(async ({ user, req }): Promise<NextResponse> => {
  let corpo;
  try {
    corpo = Corpo.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch {
    return ApiErrors.invalidRequest('Segnalazione non valida');
  }

  const admin = getAdminSupabase();
  const { data: segnalazione, error: erroreLettura } = await admin
    .from('segnalazioni')
    .select('id, tipo, oggetto_id')
    .eq('id', corpo.id)
    .maybeSingle();
  if (erroreLettura) return ApiErrors.internal('Non riesco a leggere la segnalazione');
  if (!segnalazione) return ApiErrors.notFound('Segnalazione non trovata');
  const s = segnalazione as { id: string; tipo: string; oggetto_id: string };
  if (s.tipo !== 'prodotto') {
    return ApiErrors.conflict('Da qui si tolgono solo i prodotti.');
  }

  const { data: tolti, error: erroreScrittura } = await admin
    .from('products')
    .update({ status: 'draft' })
    .eq('id', s.oggetto_id)
    .select('id');
  if (erroreScrittura) return ApiErrors.internal('Non sono riuscito a togliere il prodotto');
  if (!tolti || tolti.length === 0) return ApiErrors.notFound('Il prodotto segnalato non esiste più');

  await writeAudit({
    actorId: user.id,
    action: 'product.hide',
    targetTable: 'products',
    targetId: s.oggetto_id,
    metadata: { origine: 'segnalazione-accolta', segnalazione: s.id, dopo: { status: 'draft' } },
  });

  return NextResponse.json({ ok: true, tolto: s.oggetto_id }, { status: 200 });
});
