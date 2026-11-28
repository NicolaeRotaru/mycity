// /api/agente/clienti — la mappa dei clienti da visitare (28/11/2026, migrazione 999i).
//  · GET  — tutta la fila, ordinata per priorità. Ogni agente vede tutto, ma di un cliente preso da un altro sa solo
//    che è preso; l'admin vede anche da chi.
//  · POST { osm, azione: 'prendi' | 'lascia' | 'stato', stato? } — «Ci vado io», «Lascio», e lo stato dopo la
//    visita (visitata, si, no, iscritta; da_visitare per tornare indietro). Lascia e stato solo sui clienti propri.
// La porta degli agenti (lib/agenti/rotta.ts) fa entrare solo un agente attivo o l'admin.

import { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { conAgente } from '@/lib/agenti/rotta';
import { leggiClienti, prendi, lascia, segnaStato, statoValido, OSM, type Chi, type Esito } from '@/lib/agenti/clienti';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const nessunaCache = { 'Cache-Control': 'no-store' };
const GUASTO = 'Non riesco a leggere la mappa dei clienti in questo momento. Controlla che la migrazione 999i sia applicata, o riprova fra poco.';

export const GET = conAgente({ name: 'agente-clienti', max: 300, windowMs: 60 * 60_000 }, async ({ user, profile }) => {
  const chi: Chi = { id: user.id, admin: profile?.role === 'admin' };
  try {
    const clienti = await leggiClienti(getAdminSupabase(), chi);
    return NextResponse.json({ ok: true, data: { admin: chi.admin, clienti } }, { headers: nessunaCache });
  } catch (e) {
    logger.error('[agente-clienti] lettura non riuscita', { errore: String(e) });
    return ApiErrors.unavailable(GUASTO);
  }
});

const PERCHE: Record<Exclude<Esito, { ok: true }>['perche'], () => NextResponse> = {
  non_trovato: () => ApiErrors.notFound('Questa attività non è nella mappa.'),
  presa: () => ApiErrors.conflict('L’ha già presa un altro agente.'),
  non_tua: () => ApiErrors.forbidden('Questo cliente non è tuo: prima tocca «Ci vado io».'),
};

export const POST = conAgente({ name: 'agente-clienti-tocca', max: 600, windowMs: 60 * 60_000 }, async ({ req, user, profile }) => {
  let corpo: Record<string, unknown>;
  try {
    corpo = ((await jsonRichiesta(req, 4 * 1024)) ?? {}) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('Richiesta troppo grande.');
    return ApiErrors.invalidRequest('Richiesta non leggibile.');
  }
  const osm = typeof corpo.osm === 'string' ? corpo.osm.trim() : '';
  if (!OSM.test(osm)) return ApiErrors.invalidRequest('Attività non valida.');
  const chi: Chi = { id: user.id, admin: profile?.role === 'admin' };
  const db = getAdminSupabase();
  try {
    let esito: Esito;
    if (corpo.azione === 'prendi') esito = await prendi(db, osm, chi);
    else if (corpo.azione === 'lascia') esito = await lascia(db, osm, chi);
    else if (corpo.azione === 'stato') {
      if (!statoValido(corpo.stato)) return ApiErrors.invalidRequest('Lo stato è una di queste parole: visitata, si, no, iscritta.');
      // «esclusa» toglie l'attività dalla mappa di tutti: la decide l'admin, non un agente.
      if (corpo.stato === 'esclusa' && !chi.admin) return ApiErrors.forbidden('Togliere un’attività dalla mappa lo decide Nicola.');
      esito = await segnaStato(db, osm, corpo.stato, chi);
    } else return ApiErrors.invalidRequest('Azione non valida.');
    if (!esito.ok) return PERCHE[esito.perche]();
    return NextResponse.json({ ok: true, data: esito.cliente }, { headers: nessunaCache });
  } catch (e) {
    logger.error('[agente-clienti] scrittura non riuscita', { errore: String(e) });
    return ApiErrors.unavailable(GUASTO);
  }
});
