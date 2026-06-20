'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Plus, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { addToCart, type CartItem } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { toast } from 'sonner';

/**
 * "Completa con" — carosello upsell del carrello.
 *
 * RESKIN: presentazione soltanto. Il carosello è *retro-alimentato da dati reali*
 * — prodotti disponibili degli STESSI negozi già nel carrello (cross-sell dello
 * store), esclusi gli articoli già aggiunti. Nessun dato finto: se non ci sono
 * suggerimenti, il componente non renderizza nulla.
 *
 * L'aggiunta usa l'unica fonte di verità del carrello (`addToCart` di lib/cart),
 * identica al ProductCard: nessuna logica di stato nuova.
 */

type SuggestItem = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  seller_id: string | null;
  profiles: { store_name: string | null; is_approved: boolean } | null;
};

type Props = {
  /** Articoli attualmente nel carrello (per seller + esclusione). */
  items: CartItem[];
};

export function CartUpsell({ items }: Props) {
  // Seller distinti presenti nel carrello: la sorgente dei suggerimenti.
  const sellerIds = Array.from(
    new Set(items.map((it) => it.sellerId).filter(Boolean) as string[]),
  ).sort();
  const excludeIds = Array.from(new Set(items.map((it) => it.id))).sort();

  const { data: suggestions = [] } = useQuery({
    queryKey: ['cart-upsell', sellerIds.join(','), excludeIds.join(',')],
    enabled: sellerIds.length > 0,
    queryFn: async (): Promise<SuggestItem[]> => {
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, price, images, seller_id,
          profiles!products_seller_id_fkey ( store_name, is_approved )
        `)
        .in('seller_id', sellerIds)
        .eq('status', 'available')
        .limit(24);
      const rows = (data ?? []) as unknown as SuggestItem[];
      const inCart = new Set(excludeIds);
      return rows
        .filter((p) => p.profiles?.is_approved && !inCart.has(p.id))
        .slice(0, 8);
    },
  });

  if (suggestions.length === 0) return null;

  const handleAdd = (p: SuggestItem) => {
    addToCart({
      id: p.id,
      name: p.name,
      price: p.price,
      image: sizedImage(p.images?.[0] ?? undefined, 'card'),
      sellerId: p.seller_id ?? undefined,
      storeName: p.profiles?.store_name ?? undefined,
    });
    toast.success(`${p.name} aggiunto al carrello`, { duration: 2000 });
  };

  return (
    <section aria-label="Completa con" className="mt-2">
      <h2 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-primary-600 shrink-0" aria-hidden /> Completa con
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
        {suggestions.map((p) => {
          const img = p.images?.[0] ?? null;
          return (
            <div
              key={p.id}
              className="shrink-0 w-36 bg-white border border-cream-300 rounded-xl overflow-hidden"
            >
              <Link href={`/product/${p.id}`} className="block">
                <div className="relative w-full h-20 bg-cream-100">
                  {img && (
                    <Image
                      src={sizedImage(img, 'thumb')}
                      alt={p.name}
                      fill
                      sizes="144px"
                      unoptimized
                      className="object-cover"
                    />
                  )}
                </div>
              </Link>
              <div className="p-2">
                <Link href={`/product/${p.id}`} className="block">
                  <p className="text-xs font-semibold text-ink-900 leading-snug line-clamp-2 min-h-[2.5em] hover:text-primary-700">
                    {p.name}
                  </p>
                </Link>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-sm font-bold text-ink-900">{formatPrice(p.price)}</span>
                  <button
                    type="button"
                    onClick={() => handleAdd(p)}
                    aria-label={`Aggiungi ${p.name} al carrello`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition-all hover:bg-primary-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                  >
                    <Plus size={16} strokeWidth={2.6} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
