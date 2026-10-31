import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { chiamataDelCalendarioFerma, rispostaDelFermo } from '@/lib/cron/fermo-dei-lavori';
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

export const POST = withCronAuth(async (req): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  const esito = await frenoDellaVeloce(getAdminSupabase() as unknown as SupabaseClient);
  // 200 vuol dire «tutto a posto». Prima un carrello rimasto da sistemare a mano (per esempio la fascia
  // che non si scrive, con l'euro già tornato sulla carta) rispondeva 200 {ok:true}: il guardiano dei
  // lavori scrive nei log solo le risposte da 400 in su, e il semaforo restava verde. Adesso il pannello
  // dei lavori mostra il problema finché il carrello non è sistemato; gli amministratori l'hanno già
  // nella campanella (lib/ordini/veloce-non-confermata.ts), e il battito si scrive lo stesso.
  const tuttoAPosto = esito.ok && esito.daSistemareAMano === 0;
  return NextResponse.json(esito, { status: tuttoAPosto ? 200 : 500 });
});

export const GET = POST;
