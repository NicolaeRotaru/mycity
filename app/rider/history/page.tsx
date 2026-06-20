'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

type RiderOrderRow = {
  id: string;
  total_price: number | null;
  shipping_cost: number | null;
  delivery_status: string;
  delivered_at: string | null;
  delivery_city: string | null;
  delivery_address: string | null;
  payment_method: string | null;
};

/** Etichetta giorno: Oggi / Ieri / data lunga. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' });
}

export default function RiderHistoryPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.rider.history,
    queryFn: async (): Promise<RiderOrderRow[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select('id, total_price, shipping_cost, delivery_status, delivered_at, delivery_city, delivery_address, payment_method')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .order('delivered_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RiderOrderRow[];
    },
  });

  const totalEarned = orders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

  // Raggruppa per giorno mantenendo l'ordine (già desc per delivered_at).
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; total: number; items: RiderOrderRow[] }>();
    for (const o of orders) {
      const key = (o.delivered_at ?? '').slice(0, 10) || 'senza-data';
      const label = o.delivered_at ? dayLabel(o.delivered_at) : 'Senza data';
      if (!map.has(key)) map.set(key, { label, total: 0, items: [] });
      const g = map.get(key)!;
      g.total += Number(o.shipping_cost || 0);
      g.items.push(o);
    }
    return Array.from(map.values());
  }, [orders]);

  if (isLoading) return <LoadingState />;

  return (
    <div className="pb-5">
      <div className="px-5 pb-2 pt-4">
        <h1 className="font-serif text-[26px] font-extrabold text-ink-900">Storico consegne</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">
          {orders.length} consegne completate · {formatPrice(totalEarned)} guadagnati
        </p>
      </div>

      <div className="px-4">
        {orders.length === 0 ? (
          <div className="rounded-xl border border-cream-300 bg-surface-0 p-10 text-center text-sm text-ink-500">
            Non hai ancora completato consegne.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-[18px]">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">{g.label}</span>
                <span className="text-[13px] font-bold text-olive-700">{formatPrice(g.total)}</span>
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map((o) => (
                  <Link
                    key={o.id}
                    href={`/rider/orders/${o.id}`}
                    className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3 transition-shadow hover:shadow-warm-sm"
                  >
                    <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-olive-50 text-olive-700">
                      <Check size={16} strokeWidth={2.4} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-900">
                        {o.delivery_address}{o.delivery_city ? `, ${o.delivery_city}` : ''}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        #{o.id.slice(0, 6).toUpperCase()} · {o.payment_method === 'cod' ? 'Contanti' : 'Carta'}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold text-olive-700">+{formatPrice(o.shipping_cost || 0)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
