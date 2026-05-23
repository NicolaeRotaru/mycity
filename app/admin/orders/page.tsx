'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_COLOR,
  type OrderStatus,
} from '@/lib/order-status';

type Row = {
  id: string;
  total_price: number;
  delivery_status: OrderStatus;
  created_at: string;
  delivery_full_name: string | null;
  delivery_city: string | null;
  seller: { store_name: string | null } | null;
  rider: { full_name: string | null } | null;
};

const FILTERS = ['all', 'NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED'] as const;

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState<typeof FILTERS[number]>('all');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, total_price, delivery_status, created_at,
          delivery_full_name, delivery_city,
          seller:profiles!orders_seller_id_fkey ( store_name ),
          rider:profiles!orders_rider_id_fkey   ( full_name )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 30_000,
  });

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.delivery_status === filter);

  if (isLoading) return <div className="text-center py-8 text-gray-500">Caricamento...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ordini</h1>
        <p className="text-sm text-gray-500">{filtered.length} ordini</p>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${
              filter === f ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'Tutti' : `${ORDER_STATUS_EMOJI[f as OrderStatus]} ${ORDER_STATUS_LABEL[f as OrderStatus]}`}
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-gray-50 border-b text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="p-3 text-left">Ordine</th>
              <th className="p-3 text-left">Data</th>
              <th className="p-3 text-left">Negozio</th>
              <th className="p-3 text-left">Cliente</th>
              <th className="p-3 text-left">Rider</th>
              <th className="p-3 text-left">Stato</th>
              <th className="p-3 text-right">Totale</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const c = ORDER_STATUS_COLOR[o.delivery_status];
              return (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-mono text-xs text-gray-500">
                    <Link href={`/admin/orders/${o.id}`} className="hover:underline">
                      #{o.id.slice(0, 6).toUpperCase()}
                    </Link>
                  </td>
                  <td className="p-3 text-gray-600 whitespace-nowrap">{formatDate(o.created_at)}</td>
                  <td className="p-3 text-gray-700">{o.seller?.store_name ?? '—'}</td>
                  <td className="p-3 text-gray-700">{o.delivery_full_name ?? '—'} <span className="text-gray-400">{o.delivery_city}</span></td>
                  <td className="p-3 text-gray-700">{o.rider?.full_name ?? <span className="text-gray-400">—</span>}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}>
                      <span>{ORDER_STATUS_EMOJI[o.delivery_status]}</span>
                      {ORDER_STATUS_LABEL[o.delivery_status]}
                    </span>
                  </td>
                  <td className="p-3 text-right font-bold">{formatPrice(o.total_price)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-400">Nessun ordine</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
