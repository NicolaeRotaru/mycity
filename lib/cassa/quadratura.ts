import type { SupabaseClient } from '@supabase/supabase-js';
import { contanteDaRimettereCents } from '@/lib/shipping';
import { FUSO_PIACENZA } from '@/lib/tempo/giorno-locale';

/**
 * 22/8/2026 — LA QUADRATURA DELLA GIORNATA, IN UN POSTO SOLO.
 *
 * Stava dentro la rotta che il fattorino chiama per confermare l'incasso, ed è
 * lì che veniva ricalcolata: una volta per conferma.
 *
 * Ma la giornata cambia anche DOPO. Il fattorino conferma i contanti mentre è
 * in strada — lo stato è `OUT_FOR_DELIVERY` — e chiude la consegna qualche
 * minuto più tardi, dal browser, senza passare da nessuna rotta. Quella
 * consegna entra nel conto solo alla conferma SUCCESSIVA: se è l'ultima della
 * giornata, la successiva non arriva mai, e la riga del giorno resta indietro
 * di una consegna. È l'ultima consegna della sera, quella che il fattorino
 * ricorda meglio, a non tornare.
 *
 * Il conto non è stato riscritto in SQL apposta: sarebbe la stessa regola sui
 * soldi in due posti, che è il difetto da cui è nato tutto questo lotto. Sta
 * qui, e lo chiamano sia la rotta della conferma sia il giro notturno.
 */

export type RigaQuadratura = {
  total_price: number | string | null;
  cash_collected_cents: number | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
  pickup_in_store?: boolean | null;
};

type ClientAmministrativo = SupabaseClient;

/** Mezzanotte locale di quel giorno, espressa in UTC. */
export function inizioGiornoLocale(isoDate: string): Date {
  // Si parte dalla mezzanotte UTC e si corregge con lo scarto vero del fuso in
  // quella data: così l'ora legale è gestita dal calendario, non da una costante.
  const mezzanotteUtc = new Date(`${isoDate}T00:00:00Z`);
  const scartoMin = scartoFusoMinuti(mezzanotteUtc);
  return new Date(mezzanotteUtc.getTime() - scartoMin * 60_000);
}

/** Di quanti minuti Piacenza è avanti rispetto a Greenwich, in quella data. */
export function scartoFusoMinuti(d: Date): number {
  const locale = new Date(d.toLocaleString('en-US', { timeZone: FUSO_PIACENZA }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((locale.getTime() - utc.getTime()) / 60_000);
}

export async function aggiornaQuadratura(
  admin: ClientAmministrativo,
  riderId: string,
  isoDate: string,
): Promise<void> {
  // 189 — Prima la finestra era `T00:00:00Z … T23:59:59Z`: sbagliato due volte.
  // Il fuso (le consegne serali finivano nel giorno dopo) e l'ultimo secondo,
  // che restava fuori — una consegna alle 23:59:59.400 non veniva contata.
  const start = inizioGiornoLocale(isoDate).toISOString();
  const end = new Date(inizioGiornoLocale(isoDate).getTime() + 24 * 60 * 60_000).toISOString();

  // 🟡-7: atteso E incassato sono ancorati allo STESSO insieme di ordini —
  // quelli consegnati quel giorno (per delivered_at). Includere i COD
  // consegnati ANCHE se mai confermati fa emergere come ammanco un fattorino
  // che non conferma, invece di farlo sparire.
  const { data: deliveredRows } = await admin
    .from('orders')
    .select('total_price, cash_collected_cents, rider_fee_cents, shipping_cost, pickup_in_store')
    .eq('rider_id', riderId)
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .gte('delivered_at', start)
    .lt('delivered_at', end);

  const rows = (deliveredRows ?? []) as unknown as RigaQuadratura[];
  // 155 — L'atteso è il contante MENO il compenso che il fattorino si tiene:
  // è quello che deve davvero riportare in cassa.
  const expected = rows.reduce((s, r) => s + contanteDaRimettereCents(r), 0);
  const collected = rows.reduce((s, r) => s + Number(r.cash_collected_cents ?? 0), 0);

  const status = Math.abs(expected - collected) <= 50 ? 'OK' : 'MISMATCH';

  await admin.from('cod_reconciliations').upsert(
    {
      rider_id: riderId,
      for_date: isoDate,
      expected_cents: expected,
      collected_cents: collected,
      status,
    },
    { onConflict: 'rider_id,for_date' },
  );
}
