import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminAuth } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { liberaIClientiDi } from '@/lib/agenti/clienti';
import { creaInvito, statoInvito, GIORNI_DI_SERIE, type Agente, type Invito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * GLI AGENTI, PER NICOLA — 26/11/2026 (migrazione 865).
 * GET: gli agenti e i link d'invito. POST: un link nuovo (il codice si vede una volta sola, adesso).
 * PATCH: ritira un link, sospende o riattiva un agente. Niente si cancella: tutto resta, con la data.
 */

const MIGRAZIONE = 'Controlla che la migrazione 865 sia applicata.';
const nessunaCache = { 'Cache-Control': 'no-store' };

export const GET = withAdminAuth(async () => {
  const admin = getAdminSupabase();
  const [agenti, inviti] = await Promise.all([
    admin.from('agenti').select('user_id, email, invito_id, attivo, creato_il, sospeso_il').order('creato_il', { ascending: false }).limit(200),
    admin.from('inviti_agente').select('id, nota, creato_il, scade_il, usi_max, usi, ritirato_il').order('creato_il', { ascending: false }).limit(200),
  ]);
  if (agenti.error || inviti.error) {
    logger.error('[admin] agenti non letti', { message: agenti.error?.message ?? inviti.error?.message });
    return ApiErrors.unavailable(`Non riesco a leggere gli agenti. ${MIGRAZIONE}`);
  }
  return NextResponse.json({ ok: true, data: {
    agenti: (agenti.data ?? []) as Agente[],
    inviti: ((inviti.data ?? []) as Invito[]).map((i) => ({ ...i, stato: statoInvito(i) })),
  } }, { headers: nessunaCache });
});

const Nuovo = z.object({
  nota: z.string().trim().max(120, 'Nota troppo lunga').optional().nullable(),
  usiMax: z.number().int().min(1).max(50).optional(),
  giorni: z.number().int().min(1).max(60).optional(),
});

export const POST = withAdminAuth(async ({ req, user }) => {
  let corpo: unknown = {};
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
  }
  const esito = Nuovo.safeParse(corpo ?? {});
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  try {
    const { invito, link } = await creaInvito({ creatoDa: user.id, nota: esito.data.nota ?? null, usiMax: esito.data.usiMax ?? 1, giorni: esito.data.giorni ?? GIORNI_DI_SERIE });
    return NextResponse.json({ ok: true, data: { invito: { ...invito, stato: statoInvito(invito) }, link } }, { status: 201, headers: nessunaCache });
  } catch (errore) {
    logger.error('[admin] invito agente non creato', { errore: String(errore) });
    return ApiErrors.unavailable(`Non riesco a creare il link. ${MIGRAZIONE}`);
  }
});

const Modifica = z.discriminatedUnion('azione', [
  z.object({ azione: z.literal('ritira'), id: z.string().uuid() }),
  z.object({ azione: z.literal('sospendi'), userId: z.string().uuid() }),
  z.object({ azione: z.literal('riattiva'), userId: z.string().uuid() }),
]);

export const PATCH = withAdminAuth(async ({ req }) => {
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Modifica.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const admin = getAdminSupabase();
  const m = esito.data;
  const adesso = new Date().toISOString();
  const { data, error } = m.azione === 'ritira'
    ? await admin.from('inviti_agente').update({ ritirato_il: adesso }).eq('id', m.id).is('ritirato_il', null).select('id')
    : await admin.from('agenti').update(m.azione === 'sospendi' ? { attivo: false, sospeso_il: adesso } : { attivo: true, sospeso_il: null }).eq('user_id', m.userId).select('user_id');
  if (error) {
    logger.error('[admin] modifica agenti non riuscita', { message: error.message });
    return ApiErrors.unavailable(`Non riesco a salvare. ${MIGRAZIONE}`);
  }
  // Nessuna riga toccata: prima rispondeva «fatto» lo stesso, e Admin mostrava salvata una modifica mai avvenuta.
  if (!data?.length) return ApiErrors.conflict(m.azione === 'ritira' ? 'Questo link era già ritirato, o non esiste più.' : 'Questo agente non si trova.');
  // 28/11/2026 — Chi viene sospeso lascia liberi i suoi clienti sulla mappa (migrazione 999i). Se la tabella non c'è
  // ancora, la sospensione vale lo stesso: si annota e basta.
  if (m.azione === 'sospendi') {
    try { await liberaIClientiDi(admin, m.userId); } catch (e) { logger.warn('[admin] clienti dell agente sospeso non liberati', { message: String(e) }); }
  }
  return NextResponse.json({ ok: true }, { headers: nessunaCache });
});
