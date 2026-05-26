'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';

// Commissione marketplace e schedule payout (per ora hardcoded, in futuro
// configurabile per seller).
const COMMISSION_PCT = 8;
const PAYOUT_DAY = 5; // payout ogni 1° e 16° del mese, esempio

type PeriodKey = '7d' | '30d' | '90d' | 'all';

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d',  label: 'Ultimi 7 giorni',  days: 7 },
  { key: '30d', label: 'Ultimi 30 giorni', days: 30 },
  { key: '90d', label: 'Ultimi 90 giorni', days: 90 },
  { key: 'all', label: 'Tutto',            days: null },
];

export default function SellerEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['seller-earnings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('order_items')
        .select('quantity, unit_price, orders(id, created_at, delivery_status), products!inner(seller_id, name)')
        .eq('products.seller_id', user.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    const conf = PERIODS.find((p) => p.key === period)!;
    if (!conf.days) return items;
    const cutoff = Date.now() - conf.days * 86400000;
    return items.filter((it) => new Date(it.orders?.created_at ?? 0).getTime() >= cutoff);
  }, [items, period]);

  const gross = filtered.reduce((s, it) => s + Number(it.unit_price) * it.quantity, 0);
  const fees = (gross * COMMISSION_PCT) / 100;
  const net = gross - fees;

  // ultimi 7 giorni breakdown per mini-grafico
  const daily = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      days[k] = 0;
    }
    for (const it of items) {
      const k = (it.orders?.created_at ?? '').slice(0, 10);
      if (k in days) days[k] += Number(it.unit_price) * it.quantity;
    }
    return Object.entries(days);
  }, [items]);

  const maxDaily = Math.max(...daily.map(([, v]) => v), 1);

  // recent payouts simulati
  const payouts = useMemo(() => {
    if (filtered.length === 0) return [];
    const monthly: Record<string, number> = {};
    for (const it of filtered) {
      const k = (it.orders?.created_at ?? '').slice(0, 7); // YYYY-MM
      monthly[k] = (monthly[k] ?? 0) + Number(it.unit_price) * it.quantity * (1 - COMMISSION_PCT / 100);
    }
    return Object.entries(monthly)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 6);
  }, [filtered]);

  // prossimo payout previsto
  const nextPayout = useMemo(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), PAYOUT_DAY);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next;
  }, []);

  if (isLoading) return <div className="text-center py-8 text-ink-400">Caricamento guadagni…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900">💶 Guadagni</h1>
        <p className="text-sm text-ink-500">Tutto quello che hai incassato e quanto ti spetta.</p>
      </div>

      {/* Period switcher */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              period === p.key
                ? 'bg-primary-700 text-white'
                : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI tower */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat
          label="Fatturato lordo"
          value={formatPrice(gross)}
          hint={`${filtered.length} articoli venduti`}
          color="indigo"
        />
        <Stat
          label={`Commissione marketplace (${COMMISSION_PCT}%)`}
          value={'− ' + formatPrice(fees)}
          hint="Trattenuta automaticamente"
          color="rose"
        />
        <Stat
          label="Netto per te"
          value={formatPrice(net)}
          hint="Da ricevere via bonifico"
          color="emerald"
          highlight
        />
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
                    className="w-full bg-gradient-to-t from-primary-500 to-purple-500 rounded-t"
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

      {/* Payout schedule */}
      <section className="bg-gradient-to-br from-olive-50 to-teal-50 border border-olive-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-bold text-olive-900 mb-1 flex items-center gap-2">
              🏦 Prossimo bonifico
            </h2>
            <p className="text-sm text-olive-800">
              Riceverai i guadagni del periodo entro il{' '}
              <strong>{nextPayout.toLocaleDateString('it', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.
            </p>
            <p className="text-xs text-olive-700 mt-1">
              I bonifici partono il giorno 5 di ogni mese verso l'IBAN registrato.
            </p>
          </div>
          <Link
            href="/profile/settings"
            className="bg-white hover:bg-olive-50 border border-olive-300 text-olive-800 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap"
          >
            ⚙️ Configura IBAN
          </Link>
        </div>
      </section>

      {/* Storico mensile */}
      <section className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-bold text-ink-900">Storico mensile</h2>
          <p className="text-xs text-ink-500">Importi netti già pagati o in attesa di liquidazione</p>
        </div>
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-ink-400 text-sm">Ancora nessun guadagno nel periodo selezionato.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cream-50 text-xs uppercase text-ink-500">
              <tr>
                <th className="text-left p-3">Mese</th>
                <th className="text-right p-3">Netto</th>
                <th className="text-right p-3">Stato</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(([month, amount], i) => (
                <tr key={month} className="border-t">
                  <td className="p-3 font-medium">
                    {new Date(month + '-01').toLocaleDateString('it', { month: 'long', year: 'numeric' })}
                  </td>
                  <td className="p-3 text-right font-bold text-olive-700">{formatPrice(amount)}</td>
                  <td className="p-3 text-right">
                    {i === 0 ? (
                      <span className="bg-accent-100 text-accent-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        In attesa
                      </span>
                    ) : (
                      <span className="bg-olive-100 text-olive-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        ✓ Pagato
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Info commissioni */}
      <details className="bg-cream-50 border rounded-xl">
        <summary className="cursor-pointer p-4 font-semibold text-ink-700">
          ℹ️ Come funziona la commissione?
        </summary>
        <div className="px-4 pb-4 text-sm text-ink-600 space-y-2">
          <p>
            Su MyCity paghi <strong>solo l'{COMMISSION_PCT}% del venduto</strong> realmente concluso (non rimborsi, non ordini annullati).
            Nessuna commissione mensile, nessun costo di iscrizione.
          </p>
          <p>
            La commissione include: hosting, gateway di pagamento (quando attivo), supporto clienti, marketing locale.
            La consegna è invece pagata dal cliente direttamente al rider/al negozio.
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
      <p className={`text-3xl font-extrabold ${palette.text} mt-2`}>{value}</p>
      {hint && <p className="text-xs text-ink-500 mt-1">{hint}</p>}
    </div>
  );
}
