'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { Landmark, Info, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card } from '@/components/ui/Card';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';
import StripeConnectButton from '@/components/seller/StripeConnectButton';
import StripeDashboardButton from '@/components/seller/StripeDashboardButton';

type PeriodKey = '7d' | '30d' | '90d' | 'all';

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d',  label: '7 giorni',  days: 7 },
  { key: '30d', label: '30 giorni', days: 30 },
  { key: '90d', label: '90 giorni', days: 90 },
  { key: 'all', label: 'Tutto',     days: null },
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
      return { label: 'Stornato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'REFUNDED':
      return { label: 'Rimborsato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'FAILED':
      return { label: 'Verifica IBAN', cls: 'bg-secondary-100 text-secondary-700' };
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

  // Contanti (COD): ordini pagati alla consegna e consegnati nel periodo (dato reale).
  const codCollected = useMemo(
    () => filtered
      .filter((o) => o.payment_method === 'cod' && o.delivery_status === 'DELIVERED')
      .reduce((s, o) => s + Number(o.total_price || 0), 0),
    [filtered],
  );

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
    <div>
      <SellerPageTitle eyebrow="Portafoglio" title="Guadagni" sub="Incassi reali dai tuoi ordini e stato dei bonifici" />

      {/* Period switcher */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((p) => {
          const on = period === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={on}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                on ? 'bg-primary-700 text-white' : 'bg-white text-ink-700 ring-1 ring-inset ring-cream-300 hover:bg-cream-50'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* KPI tower */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Fatturato lordo (carta)" value={formatPrice(grossCents / 100)} hint={`${activeCard.length} ordini`} tone="primary" />
        <Stat label="Commissione marketplace" value={'− ' + formatPrice(feeCents / 100)} hint="Trattenuta automaticamente" tone="secondary" />
        <Stat label="Incassato" value={formatPrice(paidCents / 100)} hint={`${formatPrice(heldCents / 100)} in arrivo dopo la consegna`} tone="olive" highlight />
      </div>

      {/* Daily chart + COD cash card */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card variant="bordered" padding="lg">
          <h2 className="mb-4 font-serif text-lg font-bold text-ink-900">Andamento ultimi 7 giorni</h2>
          <div className="flex h-32 items-end gap-2.5">
            {daily.map(([day, val]) => {
              const pct = (val / maxDaily) * 100;
              return (
                <div key={day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-gradient-to-b from-primary-400 to-secondary-600"
                      style={{ height: `${Math.max(pct, val > 0 ? 5 : 2)}%` }}
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
        </Card>

        <Card variant="flat" padding="lg" className="border border-olive-200 bg-olive-50">
          <h2 className="flex items-center gap-2 font-serif text-[17px] font-bold text-olive-900">
            <Banknote size={19} className="text-olive-700" aria-hidden /> Contanti (COD)
          </h2>
          <p className="mb-3 mt-1 text-[13px] leading-relaxed text-olive-800">
            Gli ordini pagati alla consegna li incassa il rider e ti vengono accreditati a fine giornata.
          </p>
          <p className="font-serif text-3xl font-extrabold text-olive-900">{formatPrice(codCollected)}</p>
          <p className="mt-0.5 text-xs text-olive-700">incassati in contanti questo periodo</p>
        </Card>
      </div>

      {/* Stato bonifici (reale) */}
      <Card variant="bordered" padding="lg" className="mt-5 border-olive-200 bg-gradient-to-br from-olive-50 to-olive-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mb-1 flex items-center gap-2 font-bold text-olive-900"><Landmark size={20} className="text-olive-600" aria-hidden /> Bonifici</h2>
            <p className="text-sm text-olive-800">
              <strong>{formatPrice(paidCents / 100)}</strong> già versati ·{' '}
              <strong>{formatPrice(heldCents / 100)}</strong> in attesa di liquidazione.
            </p>
            <p className="mt-1 text-xs text-olive-700">
              Pagamento automatico ~24 ore dopo la consegna, verso l&apos;IBAN registrato su Stripe.
              Per saldo e bonifici reali apri la dashboard Stripe.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <StripeConnectButton />
            <StripeDashboardButton />
          </div>
        </div>
      </Card>

      {/* Storico pagamenti — tabella 4 colonne, ordine in mono */}
      <Card variant="bordered" padding="none" className="mt-5 overflow-hidden">
        <div className="border-b border-cream-200 px-5 py-4">
          <h2 className="font-serif text-[17px] font-bold text-ink-900">Storico pagamenti</h2>
          <p className="text-xs text-ink-500">Stato reale del bonifico per ogni ordine carta</p>
        </div>
        {cardOrders.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-400">Ancora nessun ordine pagato con carta nel periodo selezionato.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-cream-50 text-xs uppercase tracking-[0.03em] text-ink-500">
                  <th className="px-5 py-3 text-left font-bold">Ordine</th>
                  <th className="px-5 py-3 text-left font-bold">Data</th>
                  <th className="px-5 py-3 text-right font-bold">Netto</th>
                  <th className="px-5 py-3 text-right font-bold">Stato</th>
                </tr>
              </thead>
              <tbody>
                {cardOrders.slice(0, 30).map((o) => {
                  const badge = payoutBadge(o);
                  return (
                    <tr key={o.id} className="border-t border-cream-200">
                      <td className="px-5 py-3 font-mono text-[13px] text-ink-700">#{o.id.slice(0, 8)}</td>
                      <td className="px-5 py-3 text-[13px] text-ink-500">{fmtDate(o.created_at)}</td>
                      <td className="px-5 py-3 text-right font-serif text-[15px] font-bold text-olive-700">{formatPrice((o.seller_payout_cents ?? 0) / 100)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`${badge.cls} rounded-full px-2.5 py-0.5 text-xs font-semibold`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Info commissioni */}
      <details className="mt-5 rounded-xl border border-cream-300 bg-cream-50">
        <summary className="flex cursor-pointer items-center gap-2 p-4 font-semibold text-ink-700"><Info size={16} className="text-ink-500" aria-hidden /> Come funziona la commissione?</summary>
        <div className="space-y-2 px-4 pb-4 text-sm text-ink-600">
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
  label, value, hint, tone, highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'primary' | 'secondary' | 'olive';
  highlight?: boolean;
}) {
  const palette = {
    primary:   { bg: 'bg-primary-50',   text: 'text-primary-900',   border: 'border-primary-200'   },
    secondary: { bg: 'bg-secondary-50', text: 'text-secondary-700', border: 'border-secondary-200' },
    olive:     { bg: 'bg-olive-50',     text: 'text-olive-900',     border: 'border-olive-200'     },
  }[tone];
  return (
    <div className={`${palette.bg} ${highlight ? `border-2 ${palette.border} ring-2 ring-olive-300 ring-offset-2` : 'border border-transparent'} rounded-xl p-5`}>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-2 font-serif text-3xl font-extrabold ${palette.text}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
