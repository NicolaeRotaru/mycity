import type { SupabaseClient } from '@supabase/supabase-js';
import { compensoTrattenutoCents, contanteDaRimettereCents } from '@/lib/shipping';
import { incassiRimastiIndietro } from '@/lib/rider/incasso-alla-consegna';

/**
 * 15/10/2026 (R33) — LE CONSEGNE CHIUSE CON I CONTANTI ANCORA DA DICHIARARE.
 *
 * La bacheca del fattorino mostrava solo gli ordini in corso: un ordine
 * consegnato spariva, e con lui il promemoria dei contanti. Se il fattorino
 * chiudeva col codice prima di dichiarare l'incasso, nessuno glielo ricordava
 * piu', la rimessa della sera saltava l'ordine e il negozio non veniva pagato.
 *
 * La lettura passa dal client di servizio, filtrata sul fattorino che chiede:
 * la regola di lettura sugli ordini gli nasconde i consegnati da piu' di sette
 * giorni — giustamente, per i recapiti del cliente — e quei sette giorni
 * diventavano la scadenza oltre la quale il negozio non veniva pagato mai.
 * Qui non esce nessun recapito: negozio, giorno, importi.
 */
export type IncassoDaDichiarare = {
  id: string;
  deliveredAt: string | null;
  storeName: string | null;
  /** Il contante da rimettere: totale meno il compenso trattenuto. */
  expectedCents: number;
  compensoTenutoCents: number;
};

type Riga = {
  id: string;
  delivered_at: string | null;
  total_price: number | string | null;
  rider_fee_cents: number | null;
  shipping_cost: number | string | null;
  pickup_in_store: boolean | null;
  payment_method: string | null;
  delivery_status: string;
  cash_confirmed_at: string | null;
  seller: { store_name: string | null } | null;
};

/** Quante ne mostra al massimo: oltre, il problema non e' la bacheca. */
const TETTO = 50;

export async function leggiIncassiDaDichiarare(
  admin: SupabaseClient,
  riderId: string,
): Promise<{ ok: true; incassi: IncassoDaDichiarare[] } | { ok: false; motivo: string }> {
  const { data, error } = await admin
    .from('orders')
    .select(
      'id, delivered_at, total_price, rider_fee_cents, shipping_cost, pickup_in_store, payment_method, delivery_status, cash_confirmed_at, seller:profiles!orders_seller_id_fkey ( store_name )',
    )
    .eq('rider_id', riderId)
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .is('cash_confirmed_at', null)
    .order('delivered_at', { ascending: true })
    .limit(TETTO);
  if (error) return { ok: false, motivo: error.message ?? 'lettura non riuscita' };

  // Il filtro della query e la regola pura dicono la stessa cosa: si ripassa
  // dalla regola, cosi' un domani le due non possono divergere in silenzio.
  const righe = incassiRimastiIndietro((data ?? []) as unknown as Riga[]);
  return {
    ok: true,
    incassi: righe.map((r) => ({
      id: r.id,
      deliveredAt: r.delivered_at,
      storeName: r.seller?.store_name ?? null,
      expectedCents: contanteDaRimettereCents(r),
      compensoTenutoCents: compensoTrattenutoCents(r),
    })),
  };
}
