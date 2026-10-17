'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { PROPORZIONE_FOTO } from '@/lib/griglia-prodotti';
import { queryKeys } from '@/lib/queries/keys';
import { leggiSimili, type ProdottoSimile } from '@/lib/queries/fasce-prodotti';
import caricatoreFotoRemote from '@/lib/image-loader';

/** Le colonne di questa fila, in un posto solo: lo scheletro e le schede vere devono coincidere. */
const GRIGLIA_SIMILI = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3';

type Item = ProdottoSimile;

type Props = {
  productId: string;
  categoryId?: string;
  sellerId?: string;
};

/**
 * Recommendations "Potrebbe piacerti": prima cerca nello stesso negozio,
 * poi nella stessa categoria, escludendo il prodotto corrente. Massimo 6.
 *
 * Versione MVP — quando avremo dati di comportamento sufficienti
 * (product_views + acquisti correlati), si può evolvere in un sistema
 * collaborative filtering basato su "chi ha visto X ha visto anche Y".
 */
export default function SimilarProducts({ productId, categoryId, sellerId }: Props) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.products.similar(productId, categoryId, sellerId),
    // 15/10/2026 (R3) — La lettura vive in lib/queries/fasce-prodotti.ts: agganciava il
    // negozio a `profiles`, che dopo la migrazione 161 un cliente non legge piu'.
    queryFn: (): Promise<Item[]> => leggiSimili(supabase, { productId, categoryId, sellerId }),
    enabled: !!productId,
  });

  if (isLoading) {
    return (
      // Lo scheletro ha la forma della scheda vera qui sotto, non una sua: era `aspect-[3/4]` senza
      // righe di testo contro una scheda quadrata con tre righe, e al caricamento la fila saltava.
      <div className={GRIGLIA_SIMILI}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-cream-200 bg-white">
            <div className={`w-full ${PROPORZIONE_FOTO} skeleton`} />
            <div className="space-y-1 p-2">
              <div className="h-3 w-1/2 rounded skeleton" />
              <div className="h-4 min-h-[2.5rem] rounded skeleton" />
              <div className="h-4 w-1/3 rounded skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl md:text-2xl font-serif font-bold text-ink-900 mb-4 flex items-center gap-2">
        <Sparkles size={20} className="text-accent-600" />
        Potrebbe piacerti
      </h2>
      <div className={GRIGLIA_SIMILI}>
        {items.map((p) => {
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="bg-white border border-cream-200 rounded-xl overflow-hidden card-hover"
            >
              <div className="relative w-full aspect-square bg-cream-100">
                {img && (
                  <Image
                    src={sizedImage(img, 160, { quadrato: true })}
                    alt={p.name}
                    fill
                    sizes="(min-width: 768px) 160px, 50vw"
                    loader={caricatoreFotoRemote}
                    className="object-cover"
                  />
                )}
              </div>
              <div className="p-2 space-y-0.5">
                <p className="text-xs text-ink-500 truncate">{p.profiles?.store_name}</p>
                <p className="text-sm font-semibold text-ink-900 line-clamp-2 leading-snug min-h-[2.5rem]">{p.name}</p>
                <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
