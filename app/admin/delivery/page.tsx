'use client';

import { Truck, MapPin, Info, Store, Banknote, Bike } from 'lucide-react';
import {
  COMPENSO_RIDER_CENTS,
  COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS,
  CONSEGNA_NEGOZIO_IN_PIU_CENTS,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
  SUPPLEMENTO_VELOCE_CENTS,
  PICKUP_DISCOUNT_PERCENT,
  RITIRO_IN_NEGOZIO_ATTIVO,
  PLATFORM_DELIVERY_FEE_CENTS,
  RAGGIO_CONSEGNA_KM,
} from '@/lib/constants';
import { formatPrice } from '@/lib/format';

// 30/10/2026 — Diceva «3,00 €–4,00 €» a consegna: con la regola del 29/10 (consegna.promessa) la
// consegna è una per carrello, un negozio in più porta 1 € e il carrello non ha un massimo. Qui si
// dice la regola, con le cifre prese dalle costanti.
const eur = (cents: number) => formatPrice(cents / 100);
const BASE = eur(PLATFORM_DELIVERY_FEE_CENTS);
const IN_PIU = eur(CONSEGNA_NEGOZIO_IN_PIU_CENTS);
const PICCOLA = eur(SUPPLEMENTO_CONSEGNA_CENTS);
const SOGLIA = eur(SPESA_SENZA_SUPPLEMENTO_CENTS);
const VELOCE = eur(SUPPLEMENTO_VELOCE_CENTS);
const COMPENSO = `${eur(COMPENSO_RIDER_CENTS)} il giro + ${eur(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS)} a negozio in più`;
import { AdminPageTitle, AdminStatCard } from '@/components/admin/AdminUI';

/**
 * Zone & tariffe di consegna (admin · Contenuti) — SOLA LETTURA.
 *
 * La configurazione della consegna è STATICA nel codice (`lib/constants.ts`), fonte unica
 * condivisa tra la cassa e le rotte che creano l'ordine (`lib/shipping.ts`,
 * `lib/ordini/prezzi.ts`). Non esiste un meccanismo di persistenza (site_settings non contiene
 * una sezione delivery), quindi questa pagina mostra i valori REALI correnti in sola lettura.
 *
 * 27/10/2026 — Qui si mostravano la soglia della spedizione gratis (30 €), la tariffa fissa di
 * ripiego (4,90 €) e la tariffa a distanza (2,50 € più 1,20 € al km) con cinque esempi. Non
 * esistono più: il cliente paga solo la consegna, per negozio, sempre (scelta 8 della carta
 * #209), e si consegna fino a `RAGGIO_CONSEGNA_KM` dal negozio, in bici (Nicola, 27/10).
 */

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
          icon={Banknote}
          tone="accent"
          label="Consegna pagata dal cliente, per tutto il carrello"
          value={`da ${BASE}`}
        />
        <AdminStatCard
          icon={Bike}
          tone="olive"
          label="Compenso del fattorino, per giro"
          value={COMPENSO}
        />
        <AdminStatCard
          icon={MapPin}
          tone="primary"
          label="Fin dove consegniamo"
          value={`${RAGGIO_CONSEGNA_KM} km`}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* ── Costi base ── */}
        <div className="rounded-2xl border-2 border-cream-300 bg-white p-5 shadow-warm">
          <h2 className="mb-4 font-serif text-[17px] font-bold text-ink-900">Costi base</h2>
          <div className="flex flex-col gap-2.5">
            <Row
              icon={Banknote}
              title="Base della consegna"
              desc="Una volta sola per tutto il carrello, con la fascia oraria che sceglie il cliente"
              value={BASE}
            />
            <Row
              icon={Store}
              title="Ogni negozio in più"
              desc="Una fermata in più nello stesso giro"
              value={`+ ${IN_PIU}`}
            />
            <Row
              icon={Banknote}
              title="Spesa piccola"
              desc={`Per ogni negozio in cui la merce, dopo gli sconti, sta sotto i ${SOGLIA}`}
              value={`+ ${PICCOLA}`}
            />
            <Row
              icon={Truck}
              title="Consegna veloce"
              desc="Una volta sola; compresa se c'è già almeno un euro di spesa piccola"
              value={`+ ${VELOCE}`}
            />
            <Row
              icon={Bike}
              title="Compenso del fattorino"
              desc="Per il giro, non a distanza: la veloce e la spesa piccola restano a MyCity"
              value={COMPENSO}
            />
            <Row
              icon={MapPin}
              title="Confine della consegna"
              desc="In linea d'aria dal negozio: oltre, la cassa rifiuta l'indirizzo. Se il negozio non ha la posizione sulla vetrina o l'indirizzo non si trova sulla mappa, la cassa non può misurare e lo accetta: la distanza va guardata a mano"
              value={`${RAGGIO_CONSEGNA_KM} km`}
            />
            <Row
              icon={Store}
              title="Ritiro in negozio"
              desc={RITIRO_IN_NEGOZIO_ATTIVO
                ? 'Il ritiro azzera la consegna'
                : 'Messo da parte: non se n’è ancora parlato coi negozi'}
              value={RITIRO_IN_NEGOZIO_ATTIVO ? `− ${PICKUP_DISCOUNT_PERCENT}%` : 'non attivo'}
            />
          </div>
        </div>

        {/* ── Come si compone quello che paga il CLIENTE ── */}
        <div className="rounded-2xl border-2 border-cream-300 bg-white p-5 shadow-warm">
          <h2 className="mb-1 font-serif text-[17px] font-bold text-ink-900">Consegna pagata dal cliente</h2>
          <p className="mb-4 text-xs text-ink-500">
            Il cliente paga una consegna sola per tutto il carrello: {BASE} di base, {IN_PIU} per ogni negozio
            in più, {PICCOLA} per ogni negozio sotto i {SOGLIA} di merce, {VELOCE} per la veloce (compresa se
            c&apos;è già la spesa piccola). Non c&apos;è un massimo: tre negozi sotto i {SOGLIA} fanno{' '}
            {eur(PLATFORM_DELIVERY_FEE_CENTS + 2 * CONSEGNA_NEGOZIO_IN_PIU_CENTS + 3 * SUPPLEMENTO_CONSEGNA_CENTS)}.
            Il fattorino prende {COMPENSO}. Se un negozio rifiuta prima della consegna, la consegna si rifà
            sui negozi rimasti.
          </p>
        </div>
      </div>

      {/* Nota sola-lettura */}
      <div className="flex items-start gap-2.5 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          Questi parametri sono definiti nel codice (<span className="font-mono text-xs">lib/constants.ts</span>,{' '}
          <span className="font-mono text-xs">lib/shipping.ts</span>) come fonte unica condivisa tra checkout e server, così
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
