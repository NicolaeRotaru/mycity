'use client';

import { Phone, MapPin, ExternalLink, Truck, Banknote } from 'lucide-react';
import { streetFromAddress } from '@/lib/store-hours';
import type { SectionContext } from './SectionContext';

/**
 * Card "Dove siamo": indirizzo (link a Google Maps) e telefono (tel:), con righe
 * a icona e titolo serif. Pensata per la colonna destra della tab "Info & orari",
 * accanto alla card Orari. Non renderizza se mancano sia telefono sia indirizzo.
 */
export default function ContactSection({ ctx }: { ctx: SectionContext }) {
  const { store, accent } = ctx;
  const street = streetFromAddress(store.store_address);
  const mapsQuery = store.store_address
    ? encodeURIComponent(store.store_address)
    : store.store_lat && store.store_lng
      ? `${store.store_lat},${store.store_lng}`
      : null;

  if (!store.store_phone && !mapsQuery) return null;

  return (
    <section className="rounded-2xl border border-cream-300 bg-white p-6 shadow-warm-sm">
      <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
        <MapPin size={18} style={{ color: accent }} aria-hidden />
        Dove siamo
      </h2>
      <div className="flex flex-col gap-3 text-sm">
        {mapsQuery && (
          <a
            href={`https://www.google.com/maps?q=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-2.5 text-ink-700 transition-colors hover:text-ink-900"
          >
            <MapPin size={16} className="mt-0.5 shrink-0" style={{ color: accent }} aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium text-ink-900">{street ?? store.store_address}</span>
              {store.store_address && street !== store.store_address && (
                <span className="block text-ink-500">{store.store_address}</span>
              )}
              <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-ink-500 group-hover:underline">
                Apri nella mappa <ExternalLink size={11} aria-hidden />
              </span>
            </span>
          </a>
        )}

        {store.store_phone && (
          <a
            href={`tel:${store.store_phone}`}
            className="inline-flex items-center gap-2.5 text-ink-700 transition-colors hover:text-ink-900"
          >
            <Phone size={16} className="shrink-0 text-olive-600" aria-hidden />
            <span className="font-medium text-ink-900">{store.store_phone}</span>
          </a>
        )}

        {/* Righe di rassicurazione (default statici di piattaforma, non dato negozio):
            valide per tutti gli ordini su MyCity — consegna locale + pagamento alla consegna. */}
        <span className="inline-flex items-center gap-2.5 text-ink-700">
          <Truck size={16} className="shrink-0 text-olive-600" aria-hidden />
          Consegna in 24–48h
        </span>
        <span className="inline-flex items-center gap-2.5 text-ink-700">
          <Banknote size={16} className="shrink-0 text-olive-600" aria-hidden />
          Pagamento alla consegna
        </span>
      </div>
    </section>
  );
}
