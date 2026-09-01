'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShoppingBag, TrendingUp, AlertTriangle, UserCheck, Euro,
  Clock, AlertCircle, CheckCircle2, Gavel, Siren, Receipt,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { type OrderStatus } from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle, AdminSectionLabel } from '@/components/admin/AdminUI';
import { vistaDaQuery } from '@/lib/vista-query';
import { leggiCruscottoOggi, GIORNI_DI_ORDINI_FERMI, ORE_PRIMA_DI_CHIAMARLO_FERMO, type OrdineRecente } from '@/lib/queries/cruscotto-oggi';

/**
 * Admin "Today" dashboard — 1 colpo d'occhio per tutte le metriche vitali.
 *
 * Esperti consultati:
 * - Senior PM: "Senza /today dashboard, founder perde 30 min al giorno a navigare
 *   sezioni diverse. Concentrato qui = velocità decisionale."
 * - Data Analyst: "Numeri vitali: GMV oggi, ordini in problema, seller pending,
 *   SOS attivi, dispute aperte. Ognuno con link diretto."
 * - SRE: "Refresh ogni 30s. Niente realtime (overkill per admin)."
 */

export default function AdminTodayPage() {
  /**
   * 27/8/2026 (R162) — la lettura sta in `lib/queries/cruscotto-oggi`, non piu'
   * qui dentro: così una prova la può eseguire davvero. Prima nessuna delle
   * otto letture guardava se fosse riuscita, e un guasto arrivava a schermo
   * come una giornata a zero.
   */
  const query = useQuery({
    queryKey: queryKeys.admin.today,
    refetchInterval: 30_000,
    queryFn: () => leggiCruscottoOggi(supabase),
  });
  const vista = vistaDaQuery(query);

  if (vista.mostraScheletro) {
    return <LoadingState />;
  }

  // Una lettura caduta NON e' un marketplace fermo: si dice che non si sa, e si
  // offre di riprovare. E' la stessa scelta della pagina Guadagni del venditore.
  if (vista.mostraErrore || !vista.dati) {
    return (
      <div className="space-y-8">
        <AdminPageTitle eyebrow="Cockpit" title="Today" sub="Non sono riuscito a leggere i numeri di oggi" />
        <ErrorState
          title="Non sono riuscito a leggere i numeri di oggi"
          description="La lettura non è riuscita, quindi non so quanti ordini sono arrivati né quanto avete incassato. Non vuol dire che sia stato zero: riprova fra un momento."
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const stats = vista.dati;

  type KpiCardProps = {
    icon: LucideIcon;
    label: string;
    value: string | number;
    href?: string;
    color?: 'primary' | 'olive' | 'accent' | 'secondary';
    alert?: boolean;
  };
  const KpiCard = ({ icon: Icon, label, value, href, color = 'primary', alert }: KpiCardProps) => {
    const medallion: Record<string, string> = {
      primary: 'bg-primary-100 text-primary-700',
      olive: 'bg-olive-100 text-olive-700',
      accent: 'bg-accent-100 text-accent-700',
      secondary: 'bg-secondary-100 text-secondary-600',
    };
    const on = !!alert && Number(value) > 0;
    const inner = (
      <div className={`rounded-xl border-2 p-4 transition-all hover:shadow-warm ${on ? 'bg-secondary-50 border-secondary-200' : 'bg-white border-cream-300'}`}>
        <div className="mb-2.5 flex items-start justify-between">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${medallion[color]}`}>
            <Icon size={20} strokeWidth={2.2} aria-hidden />
          </span>
          {on && <AlertCircle size={16} className="text-secondary-600" aria-hidden />}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-500">{label}</p>
        <p className="mt-1 text-[26px] font-extrabold leading-none text-ink-900">{value}</p>
      </div>
    );
    return href ? <Link href={href} className="block">{inner}</Link> : inner;
  };

  return (
    <div className="space-y-8">
      <AdminPageTitle
        eyebrow="Cockpit"
        title="Today"
        sub={`${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · aggiornamento automatico ogni 30s`}
      />

      {/* Alert se ci sono problemi attivi */}
      {(stats.sosActiveCount > 0 || stats.ordersProblemCount > 0 || stats.disputesOpenCount > 0) && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-secondary-200 bg-secondary-50 p-4">
          <AlertTriangle size={24} className="mt-0.5 flex-shrink-0 text-secondary-600" strokeWidth={2.2} />
          <div className="flex-1">
            <p className="font-bold text-secondary-700">Richiede attenzione immediata</p>
            <ul className="mt-1 space-y-0.5 text-sm text-secondary-800">
              {stats.sosActiveCount > 0 && (
                <li>{stats.sosActiveCount} SOS rider attivo — <Link href="/admin/sos" className="font-semibold underline">apri</Link></li>
              )}
              {stats.ordersProblemCount > 0 && (
                <li>{stats.ordersProblemCount} ordini in problema (NEW/ACCEPTED fermi da più di {ORE_PRIMA_DI_CHIAMARLO_FERMO}h, ultimi {GIORNI_DI_ORDINI_FERMI} giorni) — <Link href="/admin/orders" className="font-semibold underline">verifica</Link></li>
              )}
              {stats.disputesOpenCount > 0 && (
                <li>{stats.disputesOpenCount} dispute aperte — <Link href="/admin/disputes" className="font-semibold underline">risolvi</Link></li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* KPI today */}
      <section>
        <AdminSectionLabel icon={TrendingUp}>Oggi</AdminSectionLabel>
        {stats.campione && (
          <p className="mb-2 text-xs font-semibold text-secondary-700">
            Oggi ci sono più ordini di quanti se ne possano leggere in una volta: ordini e incasso
            qui sotto sono un campione, non il totale della giornata.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <KpiCard icon={ShoppingBag} label="Ordini oggi" value={stats.ordersTodayCount} href="/admin/orders" color="primary" />
          <KpiCard icon={Euro} label="GMV oggi" value={formatPrice(stats.gmvToday)} color="olive" />
          <KpiCard icon={CheckCircle2} label="Consegnati" value={stats.deliveredToday} color="olive" />
          <KpiCard icon={UserCheck} label="Nuovi signup" value={stats.signupsTodayCount} href="/admin/users" color="accent" />
        </div>
      </section>

      {/* KPI in attesa */}
      <section>
        <AdminSectionLabel icon={Clock}>In attesa</AdminSectionLabel>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <KpiCard icon={Clock} label="Ordini NEW" value={stats.ordersPendingCount} href="/admin/orders" color="primary" />
          <KpiCard icon={UserCheck} label="Seller pending" value={stats.sellersPendingCount} href="/admin/users?role=seller" color="accent" />
          <KpiCard icon={Gavel} label="Reclami aperti" value={stats.disputesOpenCount} href="/admin/disputes" color="secondary" alert />
          <KpiCard icon={Siren} label="SOS attivi" value={stats.sosActiveCount} href="/admin/sos" color="secondary" alert />
        </div>
      </section>

      {/* Ultimi ordini */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <AdminSectionLabel icon={Receipt}>Ultimi 10 ordini</AdminSectionLabel>
          <Link href="/admin/orders" className="text-xs text-primary-700 hover:underline">vedi tutti →</Link>
        </div>
        <div className="overflow-hidden rounded-xl border-2 border-cream-300 bg-white">
          {stats.recentOrders.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-500">Nessun ordine ancora oggi.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-xs uppercase tracking-wider text-ink-600">
                <tr>
                  <th className="px-4 py-2.5 text-left">Ordine</th>
                  <th className="px-4 py-2.5 text-left">Negozio</th>
                  <th className="px-4 py-2.5 text-left">Cliente</th>
                  <th className="px-4 py-2.5 text-left">Stato</th>
                  <th className="px-4 py-2.5 text-right">Totale</th>
                  <th className="px-4 py-2.5 text-right">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {(stats.recentOrders as OrdineRecente[]).map((o) => (
                  <tr key={o.id} className="hover:bg-cream-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-primary-700 hover:underline">
                        #{o.id.slice(0, 6).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{o.seller?.store_name ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-700">{o.delivery_full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.delivery_status as OrderStatus} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatPrice(Number(o.total_price ?? 0))}</td>
                    <td className="px-4 py-3 text-right text-xs text-ink-500">
                      {new Date(o.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
