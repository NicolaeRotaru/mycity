'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Coffee } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';

type Store = { id: string; store_name: string | null; store_address: string | null; store_logo: string | null };
type Prod = { id: string; name: string; price: number | string; images: string[] | null };

/**
 * Card "anteprima negozio" nell'hero della home.
 *
 * Mostra un negozio REALE: il "negozio del mese" (pick admin) se impostato,
 * altrimenti un negozio approvato in evidenza, con i suoi prodotti veri.
 * Mentre i dati caricano — o se non esiste alcun negozio — mostra il
 * placeholder statico, così l'hero non resta mai vuoto.
 */
export default function HeroStoreCard() {
  const { data } = useQuery({
    queryKey: ['home', 'hero-store'],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{ store: Store; products: Prod[] } | null> => {
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const monthIso = firstOfMonth.toISOString().slice(0, 10);

      // 1) Negozio del mese (pick admin), se presente.
      const { data: som } = await supabase
        .from('shop_of_month')
        .select('seller:profiles!shop_of_month_seller_id_fkey ( id, store_name, store_address, store_logo )')
        .eq('month', monthIso)
        .maybeSingle();
      let store = (som as unknown as { seller: Store | null } | null)?.seller ?? null;

      // 2) Fallback: un negozio reale approvato.
      if (!store) {
        const { data: s } = await supabase
          .from('profiles')
          .select('id, store_name, store_address, store_logo')
          .eq('role', 'seller')
          .eq('is_approved', true)
          .not('store_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        store = (s as Store | null) ?? null;
      }
      if (!store) return null;

      const { data: prods } = await supabase
        .from('products')
        .select('id, name, price, images')
        .eq('seller_id', store.id)
        .eq('status', 'available')
        .limit(10);
      return { store, products: (prods ?? []) as Prod[] };
    },
  });

  if (!data?.store) return <HeroStorePlaceholder />;

  const { store, products } = data;
  return (
    <div className="hidden md:flex justify-center">
      <div className="relative w-full max-w-sm">
        <Link
          href={`/store/${store.id}`}
          className="block bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-6 space-y-4 overflow-hidden transition-shadow hover:shadow-warm"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center overflow-hidden shrink-0">
              {store.store_logo ? (
                <Image src={sizedImage(store.store_logo, 'thumb')} alt="" width={48} height={48} unoptimized className="object-cover w-full h-full" />
              ) : (
                <Coffee size={22} strokeWidth={2} />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ink-900 truncate">{store.store_name ?? 'Negozio'}</p>
              {store.store_address && (
                <p className="text-xs text-ink-500 flex items-center gap-1 truncate">
                  <MapPin size={12} strokeWidth={2} /> <span className="truncate">{store.store_address}</span>
                </p>
              )}
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold bg-olive-50 text-olive-700 px-2 py-0.5 rounded-full ring-1 ring-olive-200 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-olive-600 animate-pulse-soft" />
              Aperto
            </span>
          </div>

          {products.length > 0 && (
            <div className="relative -mx-6 px-6">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
                {products.map((p) => {
                  const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
                  return (
                    <div key={p.id} className="bg-cream-100 rounded-lg p-2 shrink-0 w-24 snap-start">
                      <div className="aspect-square rounded mb-1.5 overflow-hidden bg-gradient-to-br from-accent-100 to-primary-100 relative">
                        {img && <Image src={sizedImage(img, 'thumb')} alt="" fill sizes="96px" unoptimized className="object-cover" />}
                      </div>
                      <p className="text-[10px] text-ink-600 truncate">{p.name}</p>
                      <p className="text-xs font-semibold text-ink-900">{formatPrice(Number(p.price))}</p>
                    </div>
                  );
                })}
                <div aria-hidden className="shrink-0 w-2" />
              </div>
              <div aria-hidden className="pointer-events-none absolute left-0 top-0 bottom-1 w-6 bg-gradient-to-r from-white to-transparent" />
              <div aria-hidden className="pointer-events-none absolute right-0 top-0 bottom-1 w-6 bg-gradient-to-l from-white to-transparent" />
            </div>
          )}

          <div className="flex items-center justify-between text-xs pt-2 border-t border-cream-200">
            <span className="text-ink-500">Consegna stimata</span>
            <span className="font-semibold text-ink-900">oggi, entro 18:00</span>
          </div>
        </Link>
        <div className="absolute -top-4 -right-4 bg-accent-500 text-ink-900 px-3 py-1.5 rounded-full font-bold text-xs shadow-warm-lg ring-2 ring-white">
          100% locale
        </div>
      </div>
    </div>
  );
}

/** Placeholder statico (mostrato durante il caricamento o se non c'è alcun negozio). */
function HeroStorePlaceholder() {
  const demo = [
    { name: 'Coppa DOP', price: '€9,50', grad: 'from-accent-100 to-primary-100' },
    { name: 'Pancetta', price: '€7,80', grad: 'from-primary-100 to-secondary-100' },
    { name: 'Salame', price: '€12,00', grad: 'from-secondary-100 to-accent-100' },
    { name: 'Prosciutto crudo', price: '€15,00', grad: 'from-accent-100 to-cream-300' },
    { name: 'Mortadella', price: '€6,40', grad: 'from-cream-300 to-primary-100' },
    { name: 'Bresaola', price: '€18,00', grad: 'from-primary-100 to-accent-200' },
  ];
  return (
    <div className="hidden md:flex justify-center">
      <div className="relative w-full max-w-sm">
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-6 space-y-4 overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center">
              <Coffee size={22} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ink-900 truncate">Salumeria del Borgo</p>
              <p className="text-xs text-ink-500 flex items-center gap-1">
                <MapPin size={12} strokeWidth={2} /> Via Calzolai 12 · 0.4 km
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold bg-olive-50 text-olive-700 px-2 py-0.5 rounded-full ring-1 ring-olive-200 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-olive-600 animate-pulse-soft" />
              Aperto
            </span>
          </div>
          <div className="relative -mx-6 px-6">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
              {demo.map((p) => (
                <div key={p.name} className="bg-cream-100 rounded-lg p-2 shrink-0 w-24 snap-start">
                  <div className={`aspect-square rounded bg-gradient-to-br ${p.grad} mb-1.5`} />
                  <p className="text-[10px] text-ink-600 truncate">{p.name}</p>
                  <p className="text-xs font-semibold text-ink-900">{p.price}</p>
                </div>
              ))}
              <div aria-hidden className="shrink-0 w-2" />
            </div>
            <div aria-hidden className="pointer-events-none absolute left-0 top-0 bottom-1 w-6 bg-gradient-to-r from-white to-transparent" />
            <div aria-hidden className="pointer-events-none absolute right-0 top-0 bottom-1 w-6 bg-gradient-to-l from-white to-transparent" />
          </div>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-cream-200">
            <span className="text-ink-500">Consegna stimata</span>
            <span className="font-semibold text-ink-900">oggi, entro 18:00</span>
          </div>
        </div>
        <div className="absolute -top-4 -right-4 bg-accent-500 text-ink-900 px-3 py-1.5 rounded-full font-bold text-xs shadow-warm-lg ring-2 ring-white">
          100% locale
        </div>
      </div>
    </div>
  );
}
