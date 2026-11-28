'use client';

import { scrittaChiusoDaOrari } from '@/components/home/orari-di-oggi';
import Link from 'next/link';
import { Star, ChevronRight, Package } from 'lucide-react';
import StoreAvatar from './StoreAvatar';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { isVerifiedStore } from '@/lib/store-trust';
import { sizedImage } from '@/lib/image-url';
import { chiaveDiOggi, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';
import { consegnaDellaVetrina, vetrinaChiedeLaVeloce } from '@/lib/promessa-consegna';
import { useOraDiPiacenza, useVeloceDelNegozio } from '@/components/ui/DeliveryCutoff';
import type { StoreCardData, ProductPreview } from './StorePreviewCard';

interface Props {
  store: StoreCardData;
  products?: ProductPreview[];
  reviews?: { avg: number; count: number };
  distanceKm?: number | null;
}

/**
 * Riga-lista negozio (modello B) per le pagine con tanti negozi (/stores, /near):
 * stessa identità della card vetrina, ma layout orizzontale compatto, così se ne
 * scorrono molti in poco spazio (stile Glovo/Deliveroo).
 *
 * R12-014 — Le misure del testo stanno sulla scala (app/globals.css): erano 11, 13 e 15 pixel
 * scritti a mano, che la scala non ha. Ognuna sta a un pixel da due passi, e si sale al passo
 * sopra (11 → text-xs, 13 → text-sm, 15 → text-base), come la scheda prodotto, per non
 * rimpicciolire un testo piccolo; in rem, crescono anche col testo ingrandito.
 */
const StoreListRow = ({ store, products = [], reviews, distanceKm }: Props) => {
  const hours = (store.store_hours ?? {}) as StoreHours;
  const open = isOpenNow(hours[chiaveDiOggi()]);
  const street = streetFromAddress(store.store_address);
  // 30/10/2026 — Qui c'era «consegna oggi» scritto fisso, per ogni negozio a ogni ora: giovedì 29/10
  // alle 20:15 l'elenco lo diceva di Pane Quotidiano, chiuso dalle 13. Ora lo decide la stessa regola
  // della vetrina e della cassa (`consegnaDellaVetrina`); l'ora la legge il browser, quindi
  // nell'HTML del server il bollino non c'è.
  const adesso = useOraDiPiacenza();
  const veloce = useVeloceDelNegozio(store.id, vetrinaChiedeLaVeloce(store.store_hours, adesso));
  const consegna = consegnaDellaVetrina({ orari: store.store_hours, adesso, veloce });
  const thumbs = products.slice(0, 3);
  const href = `/store/${store.id}`;
  const km =
    distanceKm == null ? null : distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1).replace('.', ',')} km`;

  return (
    <Link
      href={href}
      className="group flex flex-wrap items-center gap-3 rounded-2xl border border-surface-200 bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-warm sm:gap-4"
    >
      <div className="shrink-0">
        <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="lg" />
      </div>

      <div className="min-w-0 flex-1 basis-24">
        {/* R12-009 — Senza max-w-full un nome lungo senza spazi allargava il titolo e la pagina
            sul telefono: ora il titolo resta nella scheda e il nome si taglia coi puntini.
            R12-009 (giro 2) — La riga può andare a capo (flex-wrap) e la colonna del nome ha una larghezza
            minima vera (basis-24): col testo al 200% a 280 px la colonna era larga 0 e il nome spariva;
            ora, se non c'è posto, il nome va sotto l'avatar e il resto sotto il nome. */}
        <h3 className="inline-flex max-w-full items-center gap-1.5 truncate text-base font-bold text-ink-900 group-hover:text-primary-700">
          <span className="truncate">{store.store_name}</span>
          {isVerifiedStore(store) && <VerifiedBadge size="sm" />}
        </h3>
        {street && <p className="truncate text-xs text-ink-400">{street}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {reviews ? (
            <span className="inline-flex items-center gap-1 font-bold text-ink-800">
              <Star size={13} className="fill-accent-500 text-accent-500" aria-hidden />
              {reviews.avg.toFixed(1).replace('.', ',')}
              <span className="font-normal text-ink-400">({reviews.count})</span>
            </span>
          ) : (
            <span className="max-w-full text-ink-400 [overflow-wrap:anywhere]">Nuovo</span>
          )}
          <span className={`inline-flex max-w-full items-center gap-1.5 font-semibold [overflow-wrap:anywhere] ${open ? 'text-olive-700' : 'text-ink-400'}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'bg-olive-600' : 'bg-ink-300'}`} />
            {/* 5/11/2026 — «Chiuso» accanto a «consegna oggi» senza dire quando riapre si leggeva
                come una contraddizione: si dice l'ora. */}
            {open ? 'Aperto' : scrittaChiusoDaOrari(hours)}
          </span>
        </div>
      </div>

      {thumbs.length > 0 && (
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          {thumbs.map((p) => (
            <div key={p.id} className="h-11 w-11 overflow-hidden rounded-lg bg-cream-100">
              {p.images?.[0] ? (
                <img
                  src={sizedImage(p.images[0], 'thumb')}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-cream-400">
                  <Package size={16} strokeWidth={1.6} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex max-w-full shrink-0 flex-col items-end gap-1 text-right">
        {km && <span className="text-sm font-bold text-ink-900">{km}</span>}
        {consegna && (
          <span className="rounded-full bg-olive-100 px-2 py-0.5 text-xs font-bold text-olive-700">
            {consegna === 'oggi' ? 'consegna oggi' : 'consegna domani'}
          </span>
        )}
        <ChevronRight size={16} className="text-ink-300" aria-hidden />
      </div>
    </Link>
  );
};

export default StoreListRow;
