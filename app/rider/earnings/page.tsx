'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, TrendingUp, Check, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { leggiConsegneDelFattorino } from '@/lib/rider/consegne-del-fattorino';
import { Card } from '@/components/ui/Card';
import { queryKeys } from '@/lib/queries/keys';
import RiderConnectButton from '@/components/rider/RiderConnectButton';
import { compensoConsegnaEuro } from '@/lib/shipping';
import { riepilogoFattorino } from '@/lib/guadagni/fattorino';
import { fraseAttesaBonifico } from '@/lib/stripe/tempi-bonifico';

type PeriodKey = 'today' | '7d' | '30d' | 'all';
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: 'today', label: 'Oggi',       days: 0 },
  { key: '7d',    label: '7 giorni',   days: 7 },
  { key: '30d',   label: '30 giorni',  days: 30 },
  { key: 'all',   label: 'Tutto',      days: null },
];

// 5/11/2026 — Qui c'era un premio di 2 euro alla quinta consegna del giorno: nessuno lo calcola
// né lo paga (lib/guadagni/fattorino.ts, il bonifico). Tolto finché Nicola non decide un bonus vero,
// che andrà calcolato e pagato dal server, non mostrato dal browser.

export default function RiderEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('7d');

  // 5/11/2026 — Dalla vista dello storico, non da `orders`: la regola su `orders` tiene le consegne
  // fatte solo 7 giorni, e «30 giorni» o «Tutto» contavano l'ultima settimana. E una lettura caduta
  // non è «0,00 €»: si guarda isError prima di qualunque numero.
  const { data: orders = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.rider.earnings,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      // 163 — il compenso del fattorino è `rider_fee_cents`, non `shipping_cost` (vedi compensoConsegnaEuro).
      return leggiConsegneDelFattorino(supabase, user.id);
    },
  });

  const filtered = useMemo(() => {
    const conf = PERIODS.find((p) => p.key === period)!;
    if (conf.days === null) return orders;
    if (conf.days === 0) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return orders.filter((o) => o.delivered_at && new Date(o.delivered_at) >= startOfToday);
    }
    const cutoff = Date.now() - conf.days * 86400000;
    return orders.filter((o) => o.delivered_at && new Date(o.delivered_at).getTime() >= cutoff);
  }, [orders, period]);

  // I conti stanno in lib/guadagni/fattorino.ts: sono soldi di una persona e
  // vanno provati fuori dal componente (#163).
  const riepilogo = riepilogoFattorino(filtered);
  const totalEarned = riepilogo.totale;
  const avgPerDelivery = riepilogo.media;
  const paid = riepilogo.versati;
  const pending = riepilogo.inArrivo;
  const inContanti = riepilogo.inContanti;

  // Mini-grafico ultimi 7 giorni
  const daily = useMemo(() => {
    const days: Record<string, { total: number; count: number }> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days[d.toISOString().slice(0, 10)] = { total: 0, count: 0 };
    }
    for (const o of orders) {
      const k = (o.delivered_at ?? '').slice(0, 10);
      if (k in days) {
        days[k].total += compensoConsegnaEuro(o);
        days[k].count += 1;
      }
    }
    return Object.entries(days);
  }, [orders]);
  const maxDaily = Math.max(...daily.map(([, v]) => v.total), 1);

  if (isLoading) return <LoadingState />;
  if (isError) {
    return (
      <div className="px-4 py-10">
        <ErrorState
          title="Non riesco a leggere i tuoi guadagni"
          description="Sembra un problema di collegamento: i tuoi compensi non sono spariti. Riprova."
          retry={() => { void refetch(); }}
        />
      </div>
    );
  }

  return (
    <div className="pb-5">
      {/* ScreenHead */}
      <div className="px-5 pb-2 pt-4">
        <h1 className="font-serif text-[26px] font-extrabold text-ink-900">Guadagni</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">Tutto quello che hai incassato</p>
      </div>

      {/* Period switcher */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-3.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`shrink-0 rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition-colors ${
              period === p.key
                ? 'bg-accent-500 text-ink-900'
                : 'bg-surface-0 text-ink-600 ring-1 ring-inset ring-cream-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Big number */}
      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-100 to-cream-200 p-[22px]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-accent-800">Hai guadagnato</p>
          <p className="mt-1 font-serif text-[46px] font-extrabold leading-none text-ink-900">{formatPrice(totalEarned)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-md bg-white/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-ink-500">Consegne</p>
              <p className="font-serif text-xl font-extrabold text-ink-900">{filtered.length}</p>
            </div>
            <div className="rounded-md bg-white/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-ink-500">Media/consegna</p>
              <p className="font-serif text-xl font-extrabold text-ink-900">{formatPrice(avgPerDelivery)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Proiezione */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2.5 rounded-lg border border-primary-200 bg-primary-50 px-3.5 py-3">
          <TrendingUp size={18} className="shrink-0 text-primary-700" aria-hidden />
          <p className="text-[13px] leading-relaxed text-primary-900">
            Resta online nelle ore di punta (<strong>12–14</strong> e <strong>19–21</strong>) per chiudere prima la giornata.
          </p>
        </div>
      </div>

      {/* Chart 7 giorni */}
      <div className="px-4 pb-4">
        <Card variant="bordered" padding="md">
          <p className="mb-3.5 text-sm font-bold text-ink-900">Ultimi 7 giorni</p>
          <div className="flex h-[110px] items-end gap-2">
            {daily.map(([day, v]) => {
              const pct = (v.total / maxDaily) * 100;
              return (
                <div key={day} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-sm bg-gradient-to-t from-accent-600 to-accent-400"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                      title={`${formatPrice(v.total)} · ${v.count} consegne`}
                    />
                  </div>
                  <span className="text-[10px] text-ink-400">
                    {new Date(day).toLocaleDateString('it', { weekday: 'short' }).slice(0, 1).toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Payout + IBAN */}
      <div className="px-4 pb-4">
        <Card variant="flat" padding="md" className="border border-olive-200 bg-olive-50">
          <div className="flex items-start gap-2.5">
            <Landmark size={18} className="shrink-0 text-olive-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-olive-900">Compensi sul tuo IBAN</p>
              <p className="mt-1 text-xs leading-relaxed text-olive-800">
                <strong>{formatPrice(paid)}</strong> già versati · <strong>{formatPrice(pending)}</strong> in arrivo
                (consegne pagate con carta, o col credito MyCity sopra i contanti) · <strong>{formatPrice(inContanti)}</strong> tenuti in contanti alla consegna.
              </p>
              {/* 12/11/2026 (R09-020) — «In arrivo» non diceva quando, né che senza IBAN collegato non arriva niente. */}
              <p className="mt-1 text-[11px] leading-relaxed text-olive-700">
                I compensi in arrivo passano sul tuo conto di pagamento {fraseAttesaBonifico()}; da lì alla tua banca servono alcuni giorni lavorativi, col calendario dei versamenti di Stripe. Arrivano solo se hai collegato il tuo IBAN qui sotto: finché non è collegato restano in attesa.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-olive-700">
                Sulle consegne in contanti il compenso te lo tieni tu dall&apos;incasso: rimetti in
                cassa il totale dell&apos;ordine meno il tuo compenso.
              </p>
              <div className="mt-3">
                <RiderConnectButton />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Storico consegne (filtrato dal periodo) */}
      <div className="px-4">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Storico consegne</p>
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-cream-300 bg-surface-0 p-8 text-center text-sm text-ink-500">
            Nessuna consegna in questo periodo.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.slice(0, 20).map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-50 text-olive-700">
                  <Check size={17} strokeWidth={2.4} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-900">
                    {o.delivery_address
                      ? `${o.delivery_address}${o.delivery_city ? `, ${o.delivery_city}` : ''}`
                      : `Consegna${o.delivery_city ? ` a ${o.delivery_city}` : ''}`}
                  </p>
                  <p className="text-[11px] text-ink-400">
                    {o.delivered_at ? new Date(o.delivered_at).toLocaleDateString('it-IT') : '—'} · {o.payment_method === 'cod' ? 'Contanti' : 'Carta'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 font-bold text-olive-700">
                  <Banknote size={14} className="text-olive-600" aria-hidden />
                  {formatPrice(compensoConsegnaEuro(o))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
