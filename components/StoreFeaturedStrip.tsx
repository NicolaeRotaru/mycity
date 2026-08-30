'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { queryKeys } from '@/lib/queries/keys';
import type { ColonneSalvo } from '@/lib/db-rows';

interface Props {
  sellerId: string;
  storeName?: string | null;
  productIds: string[];
  accent?: string;
}

/**
 * 30/8/2026 (R004) — Le colonne di questa vetrina vengono dallo schema.
 *
 * Prima erano riscritte a mano: una colonna rinominata avrebbe fatto tornare
 * `null` alla lettura e la striscia «In evidenza» sarebbe semplicemente
 * sparita dalla pagina del negozio, senza un errore da nessuna parte. Le
 * ri-dichiarazioni sono quelle di sempre: le foto nello schema sono un campo
 * libero, il prezzo arriva come stringa quando PostgREST serializza i
 * `numeric`, e la data di creazione sulle righe lette c'e' sempre.
 */
type Row = ColonneSalvo<
  'products',
  'id' | 'name' | 'description' | 'price' | 'images' | 'stock' | 'has_variants' | 'created_at',
  { price: number | string; images: string[] | null; has_variants: boolean | null; created_at: string }
>;

/**
 * Striscia "In evidenza": mostra i prodotti scelti dal venditore, nell'ordine
 * scelto. Ri-valida lato server proprietà (seller_id) e disponibilità (status),
 * così ID estranei/venduti non vengono mai mostrati.
 */
export default function StoreFeaturedStrip({ sellerId, storeName, productIds, accent }: Props) {
  const ids = productIds.slice(0, 8);

  const { data: products = [] } = useQuery({
    queryKey: [...queryKeys.products.all, 'featured', sellerId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, images, stock, created_at, has_variants')
        .eq('seller_id', sellerId)
        .eq('status', 'available')
        .in('id', ids);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  if (ids.length === 0 || products.length === 0) return null;

  // Preserva l'ordine scelto dal venditore
  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Row => Boolean(p));

  if (ordered.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-4 flex items-center gap-2.5">
        <span className="inline-block w-1.5 h-6 rounded-full" style={accent ? { backgroundColor: accent } : undefined} aria-hidden />
        In evidenza
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {ordered.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            description={p.description ?? ''}
            price={Number(p.price)}
            images={Array.isArray(p.images) ? p.images : []}
            stock={p.stock ?? undefined}
            hasVariants={p.has_variants ?? undefined}
            createdAt={p.created_at}
            storeName={storeName ?? undefined}
            sellerId={sellerId}
          />
        ))}
      </div>
    </section>
  );
}
