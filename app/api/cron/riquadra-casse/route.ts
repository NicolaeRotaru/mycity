import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { aggiornaQuadratura } from '@/lib/cassa/quadratura';
import { giornoLocale } from '@/lib/tempo/giorno-locale';

export const runtime = 'nodejs';

/**
 * 22/8/2026 — L'ULTIMA CONSEGNA DELLA GIORNATA POTEVA NON ENTRARE MAI IN CASSA.
 *
 * La quadratura del giorno si ricalcola quando il fattorino conferma un
 * incasso. Ma il fattorino conferma i contanti mentre è in strada — lo stato è
 * `OUT_FOR_DELIVERY` — e chiude la consegna qualche minuto dopo, dal browser,
 * senza passare da nessuna rotta.
 *
 * Quella consegna entra nel conto solo alla conferma SUCCESSIVA. Se è l'ultima
 * della giornata, la successiva non arriva: la riga del giorno resta indietro
 * di una consegna, e il fattorino si vede un ammanco che non ha.
 *
 * Questo giro rifà il conto di ieri e di oggi per ogni fattorino che ha
 * consegnato in contanti. Non ripara solo quel caso: ripara qualunque strada
 * futura che chiuda un ordine senza avvisare la cassa.
 */
const handler = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  const oggi = giornoLocale(new Date());
  const ieri = giornoLocale(new Date(Date.now() - 24 * 60 * 60_000));

  // I fattorini che hanno consegnato in contanti negli ultimi due giorni.
  // Due giorni e non uno: la giornata di ieri si chiude dopo mezzanotte, e a
  // mezzanotte il giro di ieri ha già girato.
  const dueGiorniFa = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const { data: righe, error } = await admin
    .from('orders')
    .select('rider_id, delivered_at')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .gte('delivered_at', dueGiorniFa)
    .not('rider_id', 'is', null);

  if (error) {
    logger.error('[cron] riquadra-casse: lettura fallita', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Le coppie (fattorino, giorno) da rifare: solo quelle che esistono davvero,
  // non il prodotto cartesiano.
  const daRifare = new Set<string>();
  for (const r of (righe ?? []) as Array<{ rider_id: string; delivered_at: string | null }>) {
    if (!r.delivered_at) continue;
    const giorno = giornoLocale(new Date(r.delivered_at));
    if (giorno === oggi || giorno === ieri) daRifare.add(`${r.rider_id}|${giorno}`);
  }

  let rifatte = 0;
  let falliti = 0;
  for (const chiave of daRifare) {
    const [riderId, giorno] = chiave.split('|');
    try {
      await aggiornaQuadratura(admin, riderId, giorno);
      rifatte += 1;
    } catch (e) {
      falliti += 1;
      logger.error('[cron] riquadra-casse: quadratura fallita', { riderId, giorno, e });
    }
  }

  logger.info('[cron] riquadra-casse', { rifatte, falliti, giornate: daRifare.size });
  return NextResponse.json({ ok: true, rifatte, falliti });
});

export const GET = handler;
export const POST = handler;
