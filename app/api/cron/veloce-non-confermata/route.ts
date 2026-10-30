import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { frenoDellaVeloce } from '@/lib/ordini/veloce-non-confermata';

/**
 * 30/10/2026 — IL SECONDO FRENO DELLA VELOCE (carta #220), ogni cinque minuti (vercel.json).
 *
 * Un ordine «Adesso · arrivo in 30-60 min» che il negozio non conferma in 10 minuti passa alla
 * prima fascia ancora possibile, e l'euro della veloce non si paga. Tutta la regola sta in
 * lib/ordini/veloce-non-confermata.ts; qui c'è solo la porta, con la stessa protezione degli
 * altri lavori programmati.
 */
export const runtime = 'nodejs';

export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const esito = await frenoDellaVeloce(getAdminSupabase() as unknown as SupabaseClient);
  return NextResponse.json(esito, { status: esito.ok ? 200 : 500 });
});

export const GET = POST;
