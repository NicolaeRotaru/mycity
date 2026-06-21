'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice, formatDate } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import EmptyState from '@/components/EmptyState';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { Banknote, ChevronRight, ClipboardList } from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';

type Order = {
  id: string;
  total_price: number;
  delivery_status: OrderStatus;
  payment_method?: string | null;
  created_at: string;
  delivery_full_name: string | null;
  delivery_address: string | null;
  order_items: { id: string; quantity: number }[];
};

// Gruppi fedeli al mockup (design-system/ui_kits/seller/src/30-orders.txt → SC_GROUPS):
// "Completati" include anche gli ordini annullati così la vista copre TUTTI gli stati.
const STATUS_FILTERS: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Da fare',     statuses: ['NEW', 'ACCEPTED', 'READY'] },
  { label: 'In consegna', statuses: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
  { label: 'Completati',  statuses: ['DELIVERED', 'CANCELED'] },
];

function isCod(method: string | null | undefined): boolean {
  const m = (method ?? '').toLowerCase();
  return m === 'cod' || m === 'cash';
}

export default function SellerOrdersPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.orders,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const base = (cols: string) =>
        supabase
          .from('orders')
          .select(cols)
          .eq('seller_id', user.id)
          .order('created_at', { ascending: false });
      // payment_method serve per il badge "Contanti". Se la colonna non è (ancora)
      // presente in questo ambiente, ricadiamo sulla select senza romperci.
      const withPay = await base(`
        id, total_price, delivery_status, payment_method, created_at,
        delivery_full_name, delivery_address,
        order_items ( id, quantity )
      `);
      if (!withPay.error) return (withPay.data ?? []) as unknown as Order[];
      const fallback = await base(`
        id, total_price, delivery_status, created_at,
        delivery_full_name, delivery_address,
        order_items ( id, quantity )
      `);
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []) as unknown as Order[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingState />;

  const grouped = STATUS_FILTERS.map((f) => ({
    label: f.label,
    orders: orders.filter((o) => f.statuses.includes(o.delivery_status)),
  }));

  return (
    <div>
      <SellerPageTitle
        eyebrow="Operativo"
        title="Ordini ricevuti"
        sub="Prepara, conferma e affida gli ordini ai rider"
        action={grouped.map((g) => (
          <span
            key={g.label}
            className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-600"
          >
            {g.label}: <strong className="text-ink-900">{g.orders.length}</strong>
          </span>
        ))}
      />

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-cream-300 bg-white">
          <EmptyState
            icon={ClipboardList}
            title="Nessun ordine"
            description="Non hai ancora ricevuto ordini. Quando arriveranno, li gestirai da qui."
            ctaLabel="Vai ai prodotti"
            ctaHref="/seller/products"
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) =>
            group.orders.length === 0 ? null : (
              <section key={group.label}>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.03em] text-ink-700">{group.label}</h2>
                <div className="space-y-2">
                  {group.orders.map((o) => {
                    const itemCount = o.order_items.reduce((s, i) => s + i.quantity, 0);
                    const cod = isCod(o.payment_method);
                    return (
                      <Link
                        key={o.id}
                        href={`/seller/orders/${o.id}`}
                        className="block rounded-xl border border-cream-300 bg-white px-5 py-4 transition-all hover:border-primary-200 hover:shadow-warm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-mono text-xs text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</p>
                              <span className="text-ink-300">·</span>
                              <p className="text-xs text-ink-500">{formatDate(o.created_at)}</p>
                              {cod && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-semibold text-olive-700 ring-1 ring-inset ring-olive-200">
                                  <Banknote size={12} aria-hidden /> Contanti
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 font-semibold text-ink-900">{o.delivery_full_name ?? 'Cliente'}</p>
                            <p className="truncate text-sm text-ink-500">
                              {itemCount} {itemCount === 1 ? 'articolo' : 'articoli'} · {o.delivery_address}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <OrderStatusBadge status={o.delivery_status} size="sm" />
                            <span className="font-serif font-bold text-ink-900">{formatPrice(o.total_price)}</span>
                            <ChevronRight size={18} className="text-ink-300" aria-hidden />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
