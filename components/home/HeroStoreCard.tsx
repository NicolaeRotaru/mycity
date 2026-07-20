'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Star, Home as HomeIcon, Truck, Store as StoreIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { isVerifiedStore } from '@/lib/store-trust';
import { DAY_KEYS, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';

type StoreMediaItem = { type: 'image' | 'video'; url: string };
type Store = {
  id: string; store_name: string | null; store_address: string | null; store_logo: string | null;
  store_hours?: unknown; store_media?: unknown;
  is_approved?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
};
type Prod = { id: string; name: string; price: number | string; images: string[] | null };
type Reviews = { avg: number; count: number };

/** Prima immagine di `store_media` (cover) — null se assente/non parseabile. */
function coverFromMedia(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  const first = (media as StoreMediaItem[]).find((m) => m && m.type === 'image' && typeof m.url === 'string' && m.url.length > 0);
  return first?.url ?? null;
}

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
    queryFn: async (): Promise<{ store: Store; products: Prod[]; reviews: Reviews | null } | null> => {
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const monthIso = firstOfMonth.toISOString().slice(0, 10);

      // 1) Negozio del mese (pick admin), se presente — poi vetrina pubblica per i flag trust.
      const { data: som } = await supabase
        .from('shop_of_month')
        .select('seller_id')
        .eq('month', monthIso)
        .maybeSingle();
      let storeId = (som as { seller_id?: string } | null)?.seller_id ?? null;

      // 2) Fallback: ultimo negozio approvato in vetrina pubblica.
      if (!storeId) {
        const { data: s } = await supabase
          .from('seller_public_profiles')
          .select('id')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        storeId = (s as { id?: string } | null)?.id ?? null;
      }
      if (!storeId) return null;

      const { data: storeRow } = await supabase
        .from('seller_public_profiles')
        .select('id, store_name, store_address, store_logo, store_hours, store_media, is_approved, stripe_charges_enabled, stripe_payouts_enabled')
        .eq('id', storeId)
        .maybeSingle();
      const store = (storeRow as Store | null) ?? null;

      // Prodotti reali + statistiche recensioni (RPC aggregata): la card mostra
      // rating e numero recensioni solo se esistono recensioni vere.
      const [prodsRes, reviewsRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, price, images')
          .eq('seller_id', store.id)
          .eq('status', 'available')
          .limit(10),
        supabase.rpc('store_review_stats', { p_store_ids: [store.id] }),
      ]);

      const stat = ((reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[])[0];
      const reviews: Reviews | null = stat && Number(stat.count) > 0
        ? { avg: Number(stat.avg), count: Number(stat.count) }
        : null;

      return { store, products: (prodsRes.data ?? []) as Prod[], reviews };
    },
  });

  if (!data?.store) return <HeroStorePlaceholder />;

  const { store, products, reviews } = data;

  // Stato apertura + "Consegna oggi": derivati dagli orari del negozio
  // (store_hours) SOLO se affidabilmente interpretabili — il negozio ha orari
  // configurati per oggi ed è aperto adesso. Se gli orari mancano o non sono
  // parseabili, il badge "Consegna oggi" è omesso (niente promessa di consegna
  // non supportata dai dati) e la pill mostra "Chiuso".
  const todayKey = DAY_KEYS[new Date().getDay()];
  const hours = (store.store_hours ?? null) as StoreHours | null;
  const todayIntervals = hours && typeof hours === 'object' ? hours[todayKey] : undefined;
  const openNow = Array.isArray(todayIntervals) && isOpenNow(todayIntervals);
  const deliveryToday = openNow;

  const cover = coverFromMedia(store.store_media);
  const zone = streetFromAddress(store.store_address);

  return (
    <div className="hidden md:flex justify-center">
      <div className="relative w-full max-w-sm">
        <Link
          href={`/store/${store.id}`}
          className="block bg-white border border-cream-300 rounded-2xl shadow-warm-lg overflow-hidden transition-shadow hover:shadow-warm"
        >
          {/* Cover full-width (foto reale del negozio o gradiente on-brand) con
              pill "Aperto ora / Chiuso" sovrapposta in alto a sinistra. */}
          <div className="relative h-44 w-full overflow-hidden">
            {cover ? (
              <Image src={sizedImage(cover, 'hero')} alt="" fill sizes="(max-width: 768px) 100vw, 384px" unoptimized className="object-cover" />
            ) : (
              <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600">
                <span className="absolute inset-0 flex items-center justify-center text-white/40">
                  <StoreIcon size={56} strokeWidth={1.4} aria-hidden />
                </span>
              </div>
            )}
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-ink-900/75 text-white backdrop-blur-sm">
              <span className={`w-1.5 h-1.5 rounded-full ${openNow ? 'bg-olive-400 animate-pulse-soft' : 'bg-ink-300'}`} />
              {openNow ? 'Aperto ora' : 'Chiuso'}
            </span>
          </div>

          <div className="p-5 space-y-3">
            {/* Nome negozio in SERIF + badge verificato */}
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-serif font-bold text-lg text-ink-900 truncate">{store.store_name ?? 'Negozio'}</h3>
              {isVerifiedStore(store) && <VerifiedBadge size="sm" />}
            </div>

            {/* Riga meta: rating · recensioni · zona (tutto data-driven) */}
            {(reviews || zone) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                {reviews && (
                  <span className="inline-flex items-center gap-1 font-semibold text-ink-800">
                    <Star size={13} className="fill-accent-500 text-accent-500" aria-hidden />
                    {reviews.avg.toFixed(1)}
                    <span className="font-normal text-ink-400">· {reviews.count} recensioni</span>
                  </span>
                )}
                {reviews && zone && <span aria-hidden className="text-ink-300">·</span>}
                {zone && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin size={12} strokeWidth={2} aria-hidden /> <span className="truncate">{zone}</span>
                  </span>
                )}
              </div>
            )}

            {/* Badge "Negozio locale" (sempre) + "Consegna oggi" (data-driven,
                derivato dagli orari: mostrato solo se aperto ora). */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full ring-1 ring-primary-200">
                <HomeIcon size={11} strokeWidth={2.4} aria-hidden /> Negozio locale
              </span>
              {deliveryToday && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-olive-50 text-olive-700 px-2 py-0.5 rounded-full ring-1 ring-olive-200">
                  <Truck size={11} strokeWidth={2.4} aria-hidden /> Consegna oggi
                </span>
              )}
            </div>

            {products.length > 0 && (
              <div className="relative -mx-5 px-5">
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

            {/* Riga secondaria: consegna stimata. */}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-cream-200">
              <span className="text-ink-500">Consegna stimata</span>
              <span className="font-semibold text-ink-900">oggi, entro 18:00</span>
            </div>
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
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg overflow-hidden">
          <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600">
            <span className="absolute inset-0 flex items-center justify-center text-white/40">
              <StoreIcon size={56} strokeWidth={1.4} aria-hidden />
            </span>
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-ink-900/75 text-white backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-olive-400 animate-pulse-soft" />
              Aperto ora
            </span>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-serif font-bold text-lg text-ink-900 truncate">Salumeria del Borgo</h3>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin size={12} strokeWidth={2} aria-hidden /> Via Calzolai
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full ring-1 ring-primary-200">
                <HomeIcon size={11} strokeWidth={2.4} aria-hidden /> Negozio locale
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-olive-50 text-olive-700 px-2 py-0.5 rounded-full ring-1 ring-olive-200">
                <Truck size={11} strokeWidth={2.4} aria-hidden /> Consegna oggi
              </span>
            </div>
            <div className="relative -mx-5 px-5">
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
        </div>
        <div className="absolute -top-4 -right-4 bg-accent-500 text-ink-900 px-3 py-1.5 rounded-full font-bold text-xs shadow-warm-lg ring-2 ring-white">
          100% locale
        </div>
      </div>
    </div>
  );
}
