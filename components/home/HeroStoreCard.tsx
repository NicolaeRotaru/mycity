'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Star, Home as HomeIcon, Truck, Store as StoreIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { statoDellaVista } from '@/lib/stato-vista';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { isVerifiedStore } from '@/lib/store-trust';
import { DAY_KEYS, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';
import { primoDelMesePiacenza } from '@/lib/tempo-piacenza';
import { EXPRESS_ETA_LABEL, deliveryWindow } from '@/lib/delivery';
import caricatoreFotoRemote from '@/lib/image-loader';

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
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home', 'hero-store'],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{ store: Store; products: Prod[]; reviews: Reviews | null } | null> => {
      // #83 — UNA CHIAMATA SOLA, NON TRE IN FILA.
      //
      // Prima si facevano fino a tre giri uno dietro l'altro prima di sapere
      // quale foto caricare: negozio del mese → eventuale ripiego sulla
      // vetrina → dettaglio del negozio; e solo l'ultimo passo (prodotti e
      // recensioni) era in parallelo. Tre attese di rete infilate nella prima
      // cosa che si vede aprendo il sito.
      //
      // Ora è una funzione sola nel database (`vetrina_home`, migrazione 124),
      // che torna negozio, prodotti e recensioni insieme.
      //
      // #211 — Il mese è quello di Piacenza, non di Greenwich.
      const { data: risposta, error } = await supabase.rpc('vetrina_home', {
        p_mese: primoDelMesePiacenza(),
      });
      // L'errore veniva ingoiato con un `return null`, quindi `isError` non scattava mai e il
      // riquadro cadeva sul segnaposto: cioè su un negozio inventato, mostrato come se fosse vero.
      // Adesso l'errore esce, e chi disegna può distinguere «non lo so ancora» da «è rotto».
      if (error) throw error;
      const v = risposta as { store: Store; products: Prod[] | null; reviews: Reviews | null } | null;
      if (!v?.store) return null;
      return { store: v.store, products: v.products ?? [], reviews: v.reviews };
    },
  });

  // Tre esiti, non due. Il segnaposto di prima era un negozio inventato e credibile — «Salumeria
  // del Borgo», «Via Calzolai», sei prodotti con prezzi scritti a mano, «Aperto ora», «Consegna
  // oggi entro le 18:00» — mostrato sia mentre caricava sia quando negozio non ce n'era. Un numero
  // senza fonte messo davanti a chi arriva sul sito per la prima volta.
  const vista = statoDellaVista({
    letto: !isLoading,
    caricando: isLoading,
    errore: isError || undefined,
    quanti: data?.store ? 1 : 0,
  });
  if (vista.mostraScheletro) return <HeroStoreScheletro />;
  if (vista.mostraErrore || vista.mostraVuoto) return <HeroStoreSenzaNegozio />;
  if (!data?.store) return <HeroStoreSenzaNegozio />;

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
  // La finestra di consegna la calcola la casa unica (lib/delivery), che sa qual è l'orario limite:
  // dopo quello si consegna domani, e dirlo «oggi» e' una promessa che il server poi rifiuta.
  const finestra = deliveryWindow(Date.now());
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
              <Image src={sizedImage(cover, 'hero')} alt="" fill sizes="(max-width: 768px) 100vw, 384px" loader={caricatoreFotoRemote} className="object-cover" />
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
                          {img && <Image src={sizedImage(img, 'thumb')} alt="" fill sizes="96px" loader={caricatoreFotoRemote} className="object-cover" />}
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

            {/* Riga secondaria: consegna stimata.
                «oggi, entro 18:00» era scritto a mano, e restava «oggi» anche alle 22 e anche col
                negozio chiuso. Adesso viene da `deliveryWindow`, che l'orario limite lo conosce, e
                si mostra solo se il negozio è aperto adesso: una stima su un negozio chiuso è una
                promessa che nessuno può mantenere. */}
            {openNow && (
              <div className="flex items-center justify-between text-xs pt-2 border-t border-cream-200">
                <span className="text-ink-500">Consegna stimata</span>
                <span className="font-semibold text-ink-900">
                  {finestra.day}, in {EXPRESS_ETA_LABEL}
                </span>
              </div>
            )}
          </div>
        </Link>
        <div className="absolute -top-4 -right-4 bg-accent-500 text-ink-900 px-3 py-1.5 rounded-full font-bold text-xs shadow-warm-lg ring-2 ring-white">
          100% locale
        </div>
      </div>
    </div>
  );
}

/**
 * LO SCHELETRO — la stessa forma e la stessa altezza, senza un dato inventato.
 *
 * Qui prima c'era `HeroStorePlaceholder`: un negozio finto e credibile, con nome, via, sei prodotti
 * e prezzi scritti a mano, il pallino verde «Aperto ora» e «Consegna oggi, entro 18:00». Serviva a
 * non lasciare il riquadro vuoto mentre i dati arrivavano, e il costo era che il primo schermo del
 * sito mostrava numeri che non vengono da nessuna parte. Uno scheletro fa lo stesso mestiere —
 * tenere lo spazio — senza affermare niente.
 */
function HeroStoreScheletro() {
  return (
    <div className="hidden md:flex justify-center" aria-busy="true">
      <div className="relative w-full max-w-sm">
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg overflow-hidden">
          <div className="h-44 w-full skeleton" />
          <div className="p-5 space-y-3">
            <div className="h-6 w-2/3 skeleton rounded" />
            <div className="h-3 w-1/3 skeleton rounded" />
            <div className="flex gap-2">
              <div className="h-5 w-24 skeleton rounded-full" />
              <div className="h-5 w-24 skeleton rounded-full" />
            </div>
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shrink-0 w-24 space-y-1.5">
                  <div className="aspect-square skeleton rounded" />
                  <div className="h-2 w-full skeleton rounded" />
                  <div className="h-2.5 w-2/3 skeleton rounded" />
                </div>
              ))}
            </div>
            <div className="h-3 w-full skeleton rounded mt-2" />
          </div>
        </div>
      </div>
      <span className="sr-only">Carico il negozio del mese…</span>
    </div>
  );
}

/** Nessun negozio del mese, o lettura fallita: si dice, invece di inventarne uno. */
function HeroStoreSenzaNegozio() {
  return (
    <div className="hidden md:flex justify-center">
      <div className="relative w-full max-w-sm">
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg overflow-hidden">
          <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600">
            <span className="absolute inset-0 flex items-center justify-center text-white/40">
              <StoreIcon size={56} strokeWidth={1.4} aria-hidden />
            </span>
          </div>
          <div className="p-5 space-y-3">
            <h3 className="font-serif font-bold text-lg text-ink-900">I negozi di Piacenza</h3>
            <p className="text-sm text-ink-600">
              Il negozio del mese arriva a giorni. Intanto puoi girare fra tutte le botteghe della città.
            </p>
            <a
              href="/stores"
              className="inline-flex items-center justify-center w-full bg-primary-700 hover:bg-primary-800 text-white py-2.5 rounded-lg font-bold text-sm transition-colors"
            >
              Vedi i negozi
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

