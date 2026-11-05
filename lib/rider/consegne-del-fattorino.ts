import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 5/11/2026 — LE CONSEGNE FATTE DEL FATTORINO, DA DOVE NON SPARISCONO DOPO SETTE GIORNI.
 *
 * La regola su `orders` (migrazione 127) mostra al fattorino una consegna fatta solo per 7 giorni:
 * Guadagni con «30 giorni» o «Tutto» e il contatore del profilo leggevano lì, e contavano solo
 * l'ultima settimana. La fonte giusta è la vista `rider_consegne_storico` (nessun recapito del
 * cliente, filtro sul fattorino dentro la vista). Dalla migrazione 205 ha anche lo stato del
 * bonifico; finché la 205 non è applicata la colonna manca (42703) e si ripiega su `orders`, come
 * prima: meglio i sette giorni che una pagina vuota.
 */
export type ConsegnaDelFattorino = {
  id: string;
  shipping_cost: number | null;
  rider_fee_cents: number | null;
  total_price: number | null;
  delivered_at: string | null;
  rider_payout_status: string | null;
  payment_method: string | null;
  delivery_city: string | null;
  /** Solo dal ripiego su `orders`: la vista non porta l'indirizzo del cliente. */
  delivery_address?: string | null;
};

// 5/11/2026 (unione) — `total_price` serve al riepilogo dei contanti (S01, scheda 263): la vista ce l'ha dalla 127.
const COLONNE = 'id, shipping_cost, rider_fee_cents, total_price, delivered_at, rider_payout_status, payment_method, delivery_city';

export async function leggiConsegneDelFattorino(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  riderId: string,
): Promise<ConsegnaDelFattorino[]> {
  const dallaVista = await db
    .from('rider_consegne_storico')
    .select(COLONNE)
    .order('delivered_at', { ascending: false });
  if (!dallaVista.error) return (dallaVista.data ?? []) as unknown as ConsegnaDelFattorino[];
  if ((dallaVista.error as { code?: string }).code !== '42703') throw dallaVista.error;
  const daOrders = await db
    .from('orders')
    .select(`${COLONNE}, delivery_address`)
    .eq('rider_id', riderId)
    .eq('delivery_status', 'DELIVERED')
    .order('delivered_at', { ascending: false });
  if (daOrders.error) throw daOrders.error;
  return (daOrders.data ?? []) as unknown as ConsegnaDelFattorino[];
}

/** Quante consegne ha fatto il fattorino, da sempre (la vista non ha il limite dei 7 giorni). */
export async function contaConsegneDelFattorino(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
): Promise<number> {
  const { count, error } = await db.from('rider_consegne_storico').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
