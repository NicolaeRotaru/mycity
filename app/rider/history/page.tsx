'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice, formatDate } from '@/lib/format';

export default function RiderHistoryPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['rider-history'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select('id, total_price, shipping_cost, delivery_status, delivered_at, delivery_city, delivery_address')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .order('delivered_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="text-center py-8 text-ink-500">Caricamento...</div>;

  const totalEarned = orders.reduce((s: number, o: any) => s + Number(o.shipping_cost || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Storico consegne</h1>
        <p className="text-sm text-ink-500">{orders.length} consegne completate · {formatPrice(totalEarned)} guadagnati</p>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-ink-500">
          Non hai ancora completato consegne.
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => (
            <Link
              key={o.id}
              href={`/rider/orders/${o.id}`}
              className="block bg-white border border-cream-300 rounded-xl px-5 py-3 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</p>
                  <p className="text-sm text-ink-700 truncate">{o.delivery_address}, {o.delivery_city}</p>
                  <p className="text-xs text-ink-500">{o.delivered_at ? formatDate(o.delivered_at) : '—'}</p>
                </div>
                <span className="font-bold text-olive-600">+{formatPrice(o.shipping_cost || 0)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
