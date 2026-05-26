'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { notify } from '@/lib/notifications';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type AvailableOrder = {
  id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  delivery_city: string | null;
  delivery_address: string | null;
  user_id: string;
  seller: {
    store_name: string | null;
    store_logo: string | null;
    store_address: string | null;
  } | null;
  order_items: { id: string; quantity: number }[];
};

export default function RiderDashboardPage() {
  const qc = useQueryClient();
  const router = useRouter();

  // Ordini ACCEPTED/READY senza rider + i miei ordini attivi
  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.rider.orders,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, total_price, shipping_cost, delivery_status,
          delivery_city, delivery_address, user_id, rider_id,
          seller:profiles!orders_seller_id_fkey ( store_name, store_logo, store_address ),
          order_items ( id, quantity )
        `)
        .or(`and(delivery_status.in.(ACCEPTED,READY),rider_id.is.null),rider_id.eq.${user.id}`)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as (AvailableOrder & { rider_id: string | null })[];
    },
    refetchInterval: 60_000,   // dashboard rider: 1 min è sufficiente
    refetchOnWindowFocus: true, // appena torna sulla tab fa refresh subito
    staleTime: 15_000,
  });

  const myActive   = orders.filter((o) => o.rider_id && o.delivery_status !== 'DELIVERED');
  const available  = orders.filter((o) => !o.rider_id && o.delivery_status === 'READY');
  const inPrep     = orders.filter((o) => !o.rider_id && o.delivery_status === 'ACCEPTED');

  const claim = useMutation({
    mutationFn: async (orderId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      // Atomic claim: solo se rider_id e' ancora NULL
      const { data, error } = await supabase
        .from('orders')
        .update({ rider_id: user.id, delivery_status: 'ASSIGNED' })
        .eq('id', orderId)
        .is('rider_id', null)
        .eq('delivery_status', 'READY')
        .select()
        .single();
      if (error) throw error;
      if (!data) throw new Error('Ordine già preso da un altro rider');

      // Notifiche buyer + seller
      notify({
        userId: data.user_id,
        title: '🛵 Un rider ha preso il tuo ordine',
        body: `Sta andando al negozio per ritirarlo`,
        link: `/orders/${data.id}`,
      });
      notify({
        userId: data.seller_id,
        title: '🛵 Rider in arrivo',
        body: `Un rider sta venendo a ritirare l'ordine #${data.id.slice(0, 6).toUpperCase()}`,
        link: `/seller/orders/${data.id}`,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      toast.success('Ordine assegnato a te!');
      router.push(`/rider/orders/${data.id}`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Dashboard rider</h1>
        <p className="text-sm text-ink-500">Prendi gli ordini pronti e portali ai clienti.</p>
      </div>

      {/* MIEI ORDINI ATTIVI */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3">Le tue consegne attive ({myActive.length})</h2>
        {myActive.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-500">
            Nessuna consegna in corso. Prendi un ordine qui sotto per iniziare.
          </div>
        ) : (
          <div className="space-y-2">
            {myActive.map((o) => {
              return (
                <Link
                  key={o.id}
                  href={`/rider/orders/${o.id}`}
                  className="block bg-white border-2 border-accent-300 rounded-xl px-5 py-4 hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <OrderStatusBadge status={o.delivery_status} size="sm" />
                        <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                      </div>
                      <p className="font-semibold text-ink-900">🏪 {o.seller?.store_name}</p>
                      <p className="text-sm text-ink-500 truncate">→ {o.delivery_address}, {o.delivery_city}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ORDINI DISPONIBILI */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3">Ordini disponibili ({available.length})</h2>
        {available.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-500">
            Nessun ordine pronto al momento. Riprova tra un po'.
          </div>
        ) : (
          <div className="space-y-2">
            {available.map((o) => (
              <div
                key={o.id}
                className="bg-white border border-cream-300 rounded-xl px-5 py-4 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                        📦 Pronto
                      </span>
                      <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                    </div>
                    <p className="font-semibold text-ink-900">🏪 {o.seller?.store_name}</p>
                    <p className="text-xs text-ink-500">{o.seller?.store_address}</p>
                    <p className="text-sm text-ink-700 mt-1">→ {o.delivery_address}, {o.delivery_city}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                    <button
                      onClick={() => claim.mutate(o.id)}
                      disabled={claim.isPending}
                      className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-semibold whitespace-nowrap"
                    >
                      Accetta
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ORDINI IN PREPARAZIONE — visibili ma non ancora claimabili */}
      {inPrep.length > 0 && (
        <section>
          <h2 className="font-bold text-ink-900 mb-3">
            In preparazione ({inPrep.length})
            <span className="ml-2 text-xs font-normal text-ink-500">aspetta che il negozio li renda pronti</span>
          </h2>
          <div className="space-y-2">
            {inPrep.map((o) => (
              <div
                key={o.id}
                className="bg-white border border-cream-300 rounded-xl px-5 py-4 opacity-80"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-800 ring-1 ring-primary-200">
                        👨‍🍳 In preparazione
                      </span>
                      <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                    </div>
                    <p className="font-semibold text-ink-900">🏪 {o.seller?.store_name}</p>
                    <p className="text-xs text-ink-500">{o.seller?.store_address}</p>
                    <p className="text-sm text-ink-700 mt-1">→ {o.delivery_address}, {o.delivery_city}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                    <button
                      disabled
                      className="bg-cream-200 text-ink-400 px-5 py-2.5 rounded-lg font-semibold whitespace-nowrap cursor-not-allowed"
                    >
                      ⏳ Attendi
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
