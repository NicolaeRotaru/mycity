import {
  conNegozioApprovato,
  COLONNE_NEGOZIO_IN_VETRINA,
  type LettoreVista,
} from '@/lib/queries/seller-public-profiles';

/**
 * I PREFERITI DI CHI HA L'ACCOUNT, SOLO QUELLI CHE SI POSSONO ANCORA COMPRARE.
 *
 * 15/10/2026 (R3, secondo giro) — La pagina dei preferiti agganciava il negozio
 * alla tabella `profiles` e teneva solo i prodotti con `profiles.is_approved`.
 * La migrazione 161, in attesa di firma, chiude `profiles` a chi non e' il
 * proprietario: per ogni cliente l'aggancio torna vuoto e il filtro butta via
 * tutto. La pagina diceva «Nessun preferito ancora» a chi ne aveva salvati.
 *
 * Adesso il prodotto porta solo il suo `seller_id` e il negozio lo dice la vista
 * pubblica `seller_public_profiles`, in una domanda sola per tutta la lista. La
 * regola resta quella di prima: fuori i prodotti non piu' disponibili e quelli di
 * un negozio non approvato.
 */

export type Preferito = {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  images: string[] | null;
  stock: number | null;
  has_variants: boolean | null;
  created_at: string;
  seller_id: string;
  status: string;
  profiles: { store_name: string | null; is_approved: boolean } | null;
};

type RigaPreferito = { product_id: string; products: Omit<Preferito, 'profiles'> | null };

export async function leggiPreferiti(supa: LettoreVista, userId: string): Promise<Preferito[]> {
  const { data, error } = await supa
    .from('favorites')
    .select(`
          product_id,
          products ( id, name, description, price, images, stock, has_variants, created_at, seller_id, status )
        `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const disponibili = ((data ?? []) as RigaPreferito[])
    .map((f) => f.products)
    .filter((p): p is Omit<Preferito, 'profiles'> => !!p && p.status === 'available');
  const approvati = await conNegozioApprovato(supa, disponibili, COLONNE_NEGOZIO_IN_VETRINA);
  return approvati.map((p) => ({
    ...p,
    profiles: { store_name: p.profiles.store_name ?? null, is_approved: true },
  }));
}
