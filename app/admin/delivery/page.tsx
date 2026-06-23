'use client';

import { Truck, MapPin, Info, Store, Banknote, Gift } from 'lucide-react';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_PER_ORDER,
  PICKUP_DISCOUNT_PERCENT,
  PLATFORM_DELIVERY_FEE_CENTS,
} from '@/lib/constants';
import { riderFee } from '@/lib/geo';
import { formatPrice } from '@/lib/format';
import { AdminPageTitle, AdminStatCard } from '@/components/admin/AdminUI';

/**
 * Zone & tariffe di consegna (admin · Contenuti) — SOLA LETTURA.
 *
 * La configurazione spedizione è STATICA nel codice (`lib/constants.ts` +
 * `lib/geo.ts`), fonte unica condivisa tra checkout client e API server
 * (lib/shipping.ts). Non esiste un meccanismo di persistenza (site_settings non
 * contiene una sezione delivery), quindi questa pagina mostra i valori REALI
 * correnti in sola lettura, con nota — niente salvataggi fabbricati.
 *
 * Differenza voluta dal mockup (60-content · DeliveryConfig): il mockup mostra
 * "zone per CAP" con tariffe €/km editabili. Nel prodotto reale non esistono
 * zone CAP: la tariffa di consegna è calcolata per DISTANZA (haversine →
 * riderFee) quando le coordinate sono note, con un flat di fallback. Mostriamo
 * la regola reale, non una UI inventata.
 */

// Campioni di tariffa distanza calcolati con la funzione REALE riderFee(km):
// così la tabella riflette esattamente quanto addebitato al checkout.
const DISTANCE_SAMPLES = [1, 2, 3, 5, 8].map((km) => ({ km, fee: riderFee(km) }));

export default function AdminDeliveryPage() {
  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Contenuti"
        title="Zone & tariffe di consegna"
        sub="Le tariffe applicate al checkout, lette dalla configurazione del prodotto. Sola lettura: i valori sono definiti nel codice (fonte unica condivisa client/server)."
      />

      {/* KPI riepilogo dei parametri principali */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <AdminStatCard
          icon={Gift}
          tone="olive"
          label="Spedizione gratis sopra"
          value={formatPrice(FREE_SHIPPING_THRESHOLD)}
        />
        <AdminStatCard
          icon={Truck}
          tone="primary"
          label="Flat di fallback"
          value={formatPrice(SHIPPING_PER_ORDER)}
        />
        <AdminStatCard
          icon={Banknote}
          tone="accent"
          label="Fee piattaforma / ordine"
          value={formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100)}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* ── Costi base ── */}
        <div className="rounded-2xl border-2 border-cream-300 bg-white p-5 shadow-warm">
          <h2 className="mb-4 font-serif text-[17px] font-bold text-ink-900">Costi base</h2>
          <div className="flex flex-col gap-2.5">
            <Row
              icon={Gift}
              title="Soglia spedizione gratuita"
              desc="Sopra questo subtotale la consegna è gratis"
              value={formatPrice(FREE_SHIPPING_THRESHOLD)}
            />
            <Row
              icon={Truck}
              title="Tariffa flat di fallback"
              desc="Quando le coordinate non sono note"
              value={formatPrice(SHIPPING_PER_ORDER)}
            />
            <Row
              icon={Banknote}
              title="Fee infrastruttura delivery"
              desc="Quota fissa MyCity su ogni consegna a domicilio"
              value={formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100)}
            />
            <Row
              icon={Store}
              title="Sconto ritiro in negozio"
              desc="Il ritiro azzera la spedizione"
              value={`− ${PICKUP_DISCOUNT_PERCENT}%`}
            />
          </div>
        </div>

        {/* ── Tariffa per distanza (riderFee reale) ── */}
        <div className="rounded-2xl border-2 border-cream-300 bg-white p-5 shadow-warm">
          <h2 className="mb-1 font-serif text-[17px] font-bold text-ink-900">Tariffa per distanza</h2>
          <p className="mb-4 text-xs text-ink-500">
            Quando negozio e indirizzo hanno coordinate note, la consegna è calcolata sulla distanza (haversine):
            base + €/km, arrotondata a 0,10.
          </p>
          <div className="flex flex-col gap-1.5">
            {DISTANCE_SAMPLES.map((s) => (
              <div
                key={s.km}
                className="flex items-center justify-between rounded-md bg-cream-50 px-3 py-2 text-sm"
              >
                <span className="inline-flex items-center gap-2 text-ink-600">
                  <MapPin size={14} className="text-primary-700" aria-hidden /> {s.km} km
                </span>
                <strong className="font-mono text-ink-900">{formatPrice(s.fee)}</strong>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Esempi calcolati con la funzione di tariffazione reale. Sopra {formatPrice(FREE_SHIPPING_THRESHOLD)} di
            subtotale la spedizione resta gratuita.
          </p>
        </div>
      </div>

      {/* Nota sola-lettura */}
      <div className="flex items-start gap-2.5 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          Questi parametri sono definiti nel codice (<span className="font-mono text-xs">lib/constants.ts</span>,{' '}
          <span className="font-mono text-xs">lib/geo.ts</span>) come fonte unica condivisa tra checkout e server, così
          l&apos;importo mostrato all&apos;utente coincide sempre con quello addebitato. Non sono modificabili da
          questa schermata: per cambiarli serve un rilascio.
        </p>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  desc,
  value,
}: {
  icon: typeof Truck;
  title: string;
  desc: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-cream-200 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream-100 text-primary-700">
          <Icon size={17} strokeWidth={2.2} aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          <p className="text-xs text-ink-500">{desc}</p>
        </div>
      </div>
      <strong className="font-mono text-ink-900">{value}</strong>
    </div>
  );
}
