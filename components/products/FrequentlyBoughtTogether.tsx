'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { Button } from '@/components/ui/Button';
import { queryKeys } from '@/lib/queries/keys';

/**
 * "Spesso comprati insieme" — cross-sell della PDP.
 *
 * DATO REALE: non esistono dati di co-acquisto (order pairing) nello schema,
 * quindi NON inventiamo abbinamenti. Usiamo come backing reale altri prodotti
 * disponibili DELLO STESSO NEGOZIO (acquistabili in un'unica consegna), che è il
 * suggerimento più onesto e azionabile. Se il negozio non ha altri prodotti
 * disponibili, la sezione si auto-nasconde.
 *
 * Distinto da `SimilarProducts` ("Potrebbe piacerti"), che mescola
 * stesso-venditore + stessa-categoria di altri negozi.
 */

type Item = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  stock: number | null;
  has_variants: boolean | null;
  seller_id: string | null;
};

export function FrequentlyBoughtTogether({
  productId,
  sellerId,
  storeName,
}: {
  productId: string;
  sellerId: string;
  storeName?: string;
}) {
  const { data: items = [] } = useQuery({
    queryKey: queryKeys.products.boughtTogether(productId, sellerId),
    enabled: !!sellerId,
    queryFn: async (): Promise<Item[]> => {
      const { data } = await supabase
        .from('products')
        .select('id, name, price, images, stock, has_variants, seller_id, profiles!products_seller_id_fkey!inner ( is_approved )')
        .eq('seller_id', sellerId)
        .eq('status', 'available')
        .eq('profiles.is_approved', true)
        .neq('id', productId)
        .order('created_at', { ascending: false })
        .limit(4);
      return ((data ?? []) as unknown as Item[]);
    },
    staleTime: 60_000,
  });

  if (items.length === 0) return null;

  const addOne = (p: Item) => {
    if (p.has_variants) {
      // Con varianti non possiamo scegliere taglia/colore da qui: porta alla PDP.
      toast.message('Scegli le opzioni nella scheda prodotto.');
      return;
    }
    addToCart({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      image: Array.isArray(p.images) && p.images[0] ? sizedImage(p.images[0], 'card') : undefined,
      sellerId: p.seller_id ?? sellerId,
      storeName,
    });
    toast.success(`${p.name} aggiunto al carrello`, { duration: 2000 });
  };

  return (
    <section className="mt-12">
      <h2 className="mb-4 font-serif text-2xl font-bold text-ink-900">Spesso comprati insieme</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => {
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          const out = p.stock === 0;
          return (
            <div
              key={p.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white"
            >
              <Link href={`/product/${p.id}`} className="relative block aspect-square bg-cream-100">
                {img && (
                  <Image
                    src={sizedImage(img, 'card')}
                    alt={p.name}
                    fill
                    sizes="(min-width: 1024px) 220px, 45vw"
                    unoptimized
                    className="object-cover"
                  />
                )}
              </Link>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <Link href={`/product/${p.id}`}>
                  <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-ink-900 hover:text-primary-700">
                    {p.name}
                  </p>
                </Link>
                <p className="text-base font-extrabold text-ink-900">{formatPrice(Number(p.price))}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  className="mt-auto"
                  icon={p.has_variants ? ShoppingCart : Plus}
                  disabled={out}
                  onClick={() => addOne(p)}
                >
                  {out ? 'Esaurito' : p.has_variants ? 'Scegli opzioni' : 'Aggiungi'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
