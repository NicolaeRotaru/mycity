import { incassatoDellOrdineCents, ordineContaNelFatturato, type OrdinePerMetriche } from '@/lib/metriche-venditore';

/**
 * I clienti del negozio, ricostruiti dagli ordini — con la definizione unica di
 * lib/metriche-venditore.ts: contano solo gli ordini pagati e non annullati, e
 * di ognuno quello che è entrato davvero (rimborsi tolti, credito MyCity dentro).
 * Prima la pagina sommava `total_price` di tutto, annullati e rimborsati compresi.
 */
export type CustomerRow = {
  userId: string;
  fullName: string | null;
  totalSpent: number;
  ordersCount: number;
  lastOrderAt: string;
  lastOrderId: string;
  firstOrderAt: string;
};

export type OrdineDelCliente = OrdinePerMetriche & {
  id: string;
  user_id: string | null;
  created_at: string;
  delivery_full_name: string | null;
};

/** Gli ordini arrivano dal più nuovo al più vecchio. */
export function clientiDagliOrdini(ordini: OrdineDelCliente[]): CustomerRow[] {
  const byUser = new Map<string, CustomerRow>();
  for (const o of ordini) {
    if (!o.user_id) continue;
    if (!ordineContaNelFatturato(o)) continue;
    const speso = incassatoDellOrdineCents(o) / 100;
    const nome = o.delivery_full_name?.trim() || null;
    const existing = byUser.get(o.user_id);
    if (existing) {
      existing.fullName = existing.fullName ?? nome;
      existing.totalSpent += speso;
      existing.ordersCount += 1;
      existing.firstOrderAt = o.created_at;
    } else {
      byUser.set(o.user_id, {
        userId: o.user_id,
        fullName: nome,
        totalSpent: speso,
        ordersCount: 1,
        lastOrderAt: o.created_at,
        lastOrderId: o.id,
        firstOrderAt: o.created_at,
      });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

/** Ordine medio vero: tutto lo speso diviso tutti gli ordini (non la media delle medie). */
export function ordineMedio(clienti: CustomerRow[]): number {
  const ordini = clienti.reduce((s, c) => s + c.ordersCount, 0);
  if (ordini === 0) return 0;
  return clienti.reduce((s, c) => s + c.totalSpent, 0) / ordini;
}
