'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { Euro, Landmark, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import StripeConnectButton from '@/components/seller/StripeConnectButton';
import StripeDashboardButton from '@/components/seller/StripeDashboardButton';

type PeriodKey = '7d' | '30d' | '90d' | 'all';

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d',  label: 'Ultimi 7 giorni',  days: 7 },
  { key: '30d', label: 'Ultimi 30 giorni', days: 30 },
  { key: '90d', label: 'Ultimi 90 giorni', days: 90 },
  { key: 'all', label: 'Tutto',            days: null },
];

type OrderRow = {
  id: string;
  total_price: number;
  created_at: string;
  delivery_status: string;
  payment_method: string | null;
  payout_status: string | null;
  payout_at: string | null;
  seller_payout_cents: number | null;
  application_fee_cents: number | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** Badge stato payout reale (da orders.payout_status). */
function payoutBadge(o: OrderRow): { label: string; cls: string } {
  if (o.payment_method === 'cod') return { label: 'Contanti', cls: 'bg-cream-200 text-ink-700' };
  switch (o.payout_status) {
    case 'TRANSFERRED':
      return { label: o.payout_at ? `Pagato ${fmtDate(o.payout_at)}` : 'Pagato', cls: 'bg-olive-100 text-olive-800' };
    case 'HELD':
      return { label: 'In attesa', cls: 'bg-accent-100 text-accent-800' };
    case 'PENDING_SELLER_ONBOARDING':
      return { label: 'Completa onboarding', cls: 'bg-primary-100 text-primary-800' };
    case 'REVERSED':
      return { label: 'Stornato', cls: 'bg-secondary-100 text-secondary-800' };
    case 'REFUNDED':
      return { label: 'Rimborsato', cls: 'bg-secondary-100 text-secondary-800' };
    case 'FAILED':
      return { label: 'Verifica IBAN', cls: 'bg-secondary-100 text-secondary-800' };
    default:
      return { label: o.payout_status ?? '—', cls: 'bg-cream-200 text-ink-700' };
  }
}

export default function SellerEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.earnings,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, total_price, created_at, delivery_status, payment_method, payout_status, payout_at, seller_payout_cents, application_fee_cents, stripe_transfer_id, stripe_reversal_id',
        )
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
  });

  const filtered = useMemo(() => {
    const conf = PERIODS.find((p) => p.key === period)!;
    if (!conf.days) return orders;
    const cutoff = Date.now() - conf.days * 86400000;
    return orders.filter((o) => new Date(o.created_at).getTime() >= cutoff);
  }, [orders, period]);

  // Solo ordini carta passano dai payout Stripe. I refund/storni non contano nel netto.
  const cardOrders = useMemo(() => filtered.filter((o) => o.payment_method !== 'cod'), [filtered]);
  const activeCard = useMemo(
    () => cardOrders.filter((o) => o.payout_status !== 'REFUNDED' && o.payout_status !== 'REVERSED'),
    [cardOrders],
  );

  const grossCents = activeCard.reduce((s, o) => s + Math.round(Number(o.total_price) * 100), 0);
  const feeCents = activeCard.reduce((s, o) => s + (o.application_fee_cents ?? 0), 0);

  const heldCents = cardOrders
    .filter((o) => o.payout_status === 'HELD' || o.payout_status === 'PENDING_SELLER_ONBOARDING')
    .reduce((s, o) => s + (o.seller_payout_cents ?? 0), 0);
  const paidCents = cardOrders
    .filter((o) => o.payout_status === 'TRANSFERRED')
    .reduce((s, o) => s + (o.seller_payout_cents ?? 0), 0);

  // Mini-grafico ultimi 7 giorni (incasso lordo carta per giorno).
  const daily = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    for (const o of cardOrders) {
      const k = o.created_at.slice(0, 10);
      if (k in days) days[k] += Number(o.total_price);
    }
    return Object.entries(days);
  }, [cardOrders]);
  const maxDaily = Math.max(...daily.map(([, v]) => v), 1);

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900 flex items-center gap-2"><Euro size={28} className="text-primary-600" aria-hidden /> Guadagni</h1>
        <p className="text-sm text-ink-500">Importi reali dai tuoi ordini e stato dei bonifici.</p>
      </div>

      {/* Period switcher */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              period === p.key ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI tower */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Fatturato lordo (carta)" value={formatPrice(grossCents / 100)} hint={`${activeCard.length} ordini`} color="indigo" />
        <Stat label="Commissione marketplace" value={'− ' + formatPrice(feeCents / 100)} hint="Trattenuta automaticamente" color="rose" />
        <Stat label="Incassato" value={formatPrice(paidCents / 100)} hint={`${formatPrice(heldCents / 100)} in arrivo dopo la consegna`} color="emerald" highlight />
      </div>

      {/* Daily chart */}
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-bold text-ink-900 mb-4">Andamento ultimi 7 giorni</h2>
        <div className="flex items-end gap-2 h-32">
          {daily.map(([day, val]) => {
            const pct = (val / maxDaily) * 100;
            return (
              <div key={day} className="flex-1 flex flex-col items-center gap-1">
                <div className="flex-1 w-full flex items-end">
                  <div
                    className="w-full bg-gradient-to-t from-primary-500 to-secondary-500 rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                    title={formatPrice(val)}
                  />
                </div>
                <span className="text-[10px] text-ink-500">
                  {new Date(day).toLocaleDateString('it', { weekday: 'short' })}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stato bonifici (reale) */}
      <section className="bg-gradient-to-br from-olive-50 to-olive-100 border border-olive-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-bold text-olive-900 mb-1 flex items-center gap-2"><Landmark size={20} className="text-olive-600" aria-hidden /> Bonifici</h2>
            <p className="text-sm text-olive-800">
              <strong>{formatPrice(paidCents / 100)}</strong> già versati ·{' '}
              <strong>{formatPrice(heldCents / 100)}</strong> in attesa di liquidazione.
            </p>
            <p className="text-xs text-olive-700 mt-1">
              Pagamento automatico ~24 ore dopo la consegna, verso l&apos;IBAN registrato su Stripe.
              Per saldo e bonifici reali apri la dashboard Stripe.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <StripeConnectButton />
            <StripeDashboardButton />
          </div>
        </div>
      </section>

      {/* Storico ordini (stato payout reale) */}
      <section className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-bold text-ink-900">Storico pagamenti</h2>
          <p className="text-xs text-ink-500">Stato reale del bonifico per ogni ordine</p>
        </div>
        {cardOrders.length === 0 ? (
          <div className="p-8 text-center text-ink-400 text-sm">Ancora nessun ordine pagato con carta nel periodo selezionato.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cream-50 text-xs uppercase text-ink-500">
              <tr>
                <th className="text-left p-3">Ordine</th>
                <th className="text-right p-3">Netto</th>
                <th className="text-right p-3">Stato</th>
              </tr>
            </thead>
            <tbody>
              {cardOrders.slice(0, 30).map((o) => {
                const badge = payoutBadge(o);
                return (
                  <tr key={o.id} className="border-t">
                    <td className="p-3">
                      <span className="font-medium">#{o.id.slice(0, 8)}</span>
                      <span className="text-xs text-ink-400 ml-2">{fmtDate(o.created_at)}</span>
                    </td>
                    <td className="p-3 text-right font-bold text-olive-700">{formatPrice((o.seller_payout_cents ?? 0) / 100)}</td>
                    <td className="p-3 text-right">
                      <span className={`${badge.cls} text-xs font-semibold px-2 py-0.5 rounded-full`}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Info commissioni */}
      <details className="bg-cream-50 border rounded-xl">
        <summary className="cursor-pointer p-4 font-semibold text-ink-700 flex items-center gap-2"><Info size={16} className="text-ink-500" aria-hidden /> Come funziona la commissione?</summary>
        <div className="px-4 pb-4 text-sm text-ink-600 space-y-2">
          <p>
            Su MyCity paghi <strong>solo l&apos;8% del venduto</strong> realmente concluso (non rimborsi, non ordini annullati).
            Nessuna commissione mensile, nessun costo di iscrizione.
          </p>
          <p>
            Il bonifico parte <strong>in automatico ~24 ore dopo la consegna</strong>. In caso di reso o contestazione la
            quota corrispondente viene trattenuta o recuperata.
          </p>
        </div>
      </details>
    </div>
  );
}

function Stat({
  label, value, hint, color, highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  color: 'indigo' | 'rose' | 'emerald';
  highlight?: boolean;
}) {
  const palette = {
    indigo:  { bg: 'bg-primary-50',  text: 'text-primary-900',  border: 'border-primary-200'  },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-900',    border: 'border-rose-200'    },
    emerald: { bg: 'bg-olive-50', text: 'text-olive-900', border: 'border-olive-200' },
  }[color];
  return (
    <div className={`${palette.bg} ${palette.border} border-2 ${highlight ? 'ring-2 ring-offset-2 ring-olive-300' : ''} rounded-xl p-5`}>
      <p className="text-xs uppercase tracking-wide font-bold text-ink-500">{label}</p>
      <p className={`text-3xl font-extrabold font-serif ${palette.text} mt-2`}>{value}</p>
      {hint && <p className="text-xs text-ink-500 mt-1">{hint}</p>}
    </div>
  );
}
