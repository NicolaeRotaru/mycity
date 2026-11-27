// GET /api/agente/schede — chi sono e le mie ultime schede (al massimo 20), per riaprirle.
// 27/11/2026 — E le attività che il titolare ha già confermato (migrazione 999c), per riaprire «Adesso tocca a SDG».
import { NextResponse } from 'next/server';
import { conAgente } from '@/lib/agenti/rotta';
import { elencoSchede } from '@/lib/agenti/n8n';
import { attivitaConfermate } from '@/lib/agenti/attivita';
import { getAdminSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = conAgente({ name: 'agente-schede', max: 120, windowMs: 60 * 60_000 }, async ({ email }) => {
  const [schede, confermate] = await Promise.all([
    elencoSchede(email),
    // Senza la chiave di servizio o senza la 999c l'elenco resta vuoto: le schede si vedono lo stesso.
    (async () => { try { return await attivitaConfermate(getAdminSupabase(), email); } catch { return []; } })(),
  ]);
  return NextResponse.json({ ok: true, data: { email, schede, confermate } }, { headers: { 'Cache-Control': 'no-store' } });
});
