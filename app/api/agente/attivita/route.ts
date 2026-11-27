// GET /api/agente/attivita?lavoro=<uuid> — l'attività nata da una scheda, dopo il «Sì, aggiungi» (27/11/2026).
//
// Nicola, 27/11 17:25: quando il titolare conferma l'abbonamento dal link, la pagina dell'agente «deve aggiornarsi e
// portarlo alla pagina con su scritto tutte le cose che deve fare adesso SDG». La pagina chiede qui ogni 10 secondi
// (components/agenti/AggiungiAttivita.tsx) se il preventivo è passato ad «accettato»; la pagina «Adesso tocca a SDG»
// (app/agente/tocca-a-sdg) ci legge i passi. Un agente vede solo le attività che ha portato lui; l'admin tutte,
// come /api/agente/stato. Quello che non è suo risponde come quello che non c'è (404).

import { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { conAgente } from '@/lib/agenti/rotta';
import { attivitaDelLavoro } from '@/lib/agenti/attivita';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 10 secondi per 30 minuti fanno 180 domande per scheda: il freno ne lascia 600 l'ora, per più schede aperte.
export const GET = conAgente({ name: 'agente-attivita', max: 600, windowMs: 60 * 60_000 }, async ({ req, email, profile }) => {
  const lavoro = new URL(req.url).searchParams.get('lavoro') ?? '';
  if (!UUID.test(lavoro)) return ApiErrors.invalidRequest('Codice del lavoro non valido.');
  try {
    const attivita = await attivitaDelLavoro(getAdminSupabase(), lavoro, { email, admin: profile?.role === 'admin' });
    if (!attivita) return ApiErrors.notFound('Nessuna attività aggiunta da questa scheda.');
    return NextResponse.json({ ok: true, data: attivita }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    logger.error('[agente-attivita] lettura non riuscita', { errore: String(e) });
    return ApiErrors.unavailable('Non riesco a leggere l’attività in questo momento. Controlla che la migrazione 999c sia applicata, o riprova fra poco.');
  }
});
