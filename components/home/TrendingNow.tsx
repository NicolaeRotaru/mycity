'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ArrowRight, Flame, ShoppingBag, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';
import { leggiTendenze, type Tendenza } from '@/lib/queries/fasce-prodotti';
import caricatoreFotoRemote from '@/lib/image-loader';

type Trending = Tendenza;

/**
 * Quante visite nelle ultime 24 ore servono a un prodotto per entrare nella classifica.
 *
 * 31/10/2026 — LA CLASSIFICA ERA FINTA. Senza visite la lettura ripiega sugli ultimi prodotti
 * pubblicati (`view_count: 0`), e questo riquadro li metteva in fila con le medaglie #1, #2 e #3
 * sotto «Trending ora»: una classifica senza nessuna visita e nessuna vendita dietro. Tolto il
 * negozio di prova, le medaglie sarebbero andate ai prodotti di Pane Quotidiano per il solo
 * fatto di essere gli ultimi caricati.
 *
 * Adesso entra solo chi ha visite misurate, almeno queste. Sotto la soglia il riquadro non si
 * disegna: meglio nessuna classifica che una classifica inventata.
 */
export const VISITE_MINIME_PER_LA_CLASSIFICA = 3;

/** I prodotti che la classifica può mostrare: solo quelli con visite vere, dal più visto. */
export function classificaVera(items: readonly Trending[]): Trending[] {
  return items
    .filter((it) => Number(it.view_count) >= VISITE_MINIME_PER_LA_CLASSIFICA)
    .sort((a, b) => b.view_count - a.view_count);
}

/**
 * "Trending ora": top 8 prodotti più visualizzati nelle ultime 24h.
 * Aggrega `product_views` (vedi migration 027). Se nessun prodotto arriva alla soglia di
 * visite qui sopra, il riquadro non c'è.
 */
export default function TrendingNow() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.home.trendingNow,
    // 15/10/2026 (R3) — La lettura vive in lib/queries/fasce-prodotti.ts: agganciava il
    // negozio a `profiles`, che dopo la migrazione 161 un cliente non legge piu', e la
    // fascia restava vuota per tutti tranne il negoziante e l'amministratore.
    queryFn: (): Promise<Trending[]> => leggiTendenze(supabase),
    refetchInterval: 5 * 60_000, // ogni 5 minuti
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-44 rounded-xl skeleton" aria-hidden />
        ))}
      </div>
    );
  }

  const classifica = classificaVera(items);
  if (classifica.length === 0) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
            <TrendingUp size={14} strokeWidth={2.4} />
            Trending ora
          </span>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
            Quello che gira oggi a Piacenza
          </h2>
        </div>
        <Link href="/search" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
          Vedi tutto <ArrowRight size={16} strokeWidth={2.4} />
        </Link>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {classifica.map((it, i) => {
          const p = it.product;
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="group relative bg-white rounded-xl border border-cream-300 overflow-hidden card-hover"
            >
              <div className="relative aspect-square bg-cream-100 overflow-hidden">
                {img ? (
                  <Image
                    src={sizedImage(img, 'card')}
                    alt={p.name}
                    fill
                    sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 33vw"
                    loader={caricatoreFotoRemote}
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-cream-300"><ShoppingBag size={44} aria-hidden /></div>
                )}
                {/* Rank badge per i primi 3 */}
                {i < 3 && (
                  <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                    i === 0 ? 'bg-accent-500 text-ink-900' :
                    i === 1 ? 'bg-cream-300 text-ink-900' :
                              'bg-primary-200 text-primary-800'
                  }`}>
                    <Flame size={10} strokeWidth={2.4} />
                    #{i + 1}
                  </div>
                )}
                {it.view_count > 5 && (
                  <div className="absolute bottom-2 right-2 bg-ink-900/80 backdrop-blur text-white text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                    <Eye size={12} aria-hidden /> {it.view_count}
                  </div>
                )}
              </div>
              <div className="p-2.5 space-y-0.5">
                <p className="text-[11px] text-ink-500 truncate">{p.profiles?.store_name}</p>
                <p className="text-xs font-semibold text-ink-900 line-clamp-2 min-h-[2rem] leading-snug">{p.name}</p>
                <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
