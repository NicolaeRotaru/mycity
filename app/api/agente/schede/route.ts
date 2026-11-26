// GET /api/agente/schede — chi sono e le mie ultime schede (al massimo 20), per riaprirle.
import { NextResponse } from 'next/server';
import { conAgente } from '@/lib/agenti/rotta';
import { elencoSchede } from '@/lib/agenti/n8n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = conAgente({ name: 'agente-schede', max: 120, windowMs: 60 * 60_000 }, async ({ email }) => {
  const schede = await elencoSchede(email);
  return NextResponse.json({ ok: true, data: { email, schede } }, { headers: { 'Cache-Control': 'no-store' } });
});
