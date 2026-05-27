'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

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
    queryKey: queryKeys.admin.orders,
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

  if (isLoading) return <LoadingState />;

  // Export CSV — Operations Manager: "indispensabile per commercialista"
  const exportCSV = () => {
    const headers = ['ID', 'Data', 'Cliente', 'Città', 'Negozio', 'Rider', 'Stato', 'Totale €'];
    const rows = filtered.map((o) => [
      o.id,
      o.created_at,
      o.delivery_full_name ?? '',
      o.delivery_city ?? '',
      o.seller?.store_name ?? '',
      o.rider?.full_name ?? '',
      o.delivery_status,
      String(Number(o.total_price).toFixed(2)),
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM per Excel IT
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mycity-ordini-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Ordini</h1>
          <p className="text-sm text-ink-500">{filtered.length} ordini</p>
        </div>
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 disabled:opacity-50 text-ink-700 px-4 py-2 rounded-lg font-semibold text-sm"
        >
          Esporta CSV
        </button>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${
              filter === f ? 'bg-rose-600 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
            }`}
          >
            {f === 'all' ? 'Tutti' : ORDER_STATUS_LABEL[f as OrderStatus]}
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
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
              return (
                <tr key={o.id} className="border-t hover:bg-cream-50">
                  <td className="p-3 font-mono text-xs text-ink-500">
                    <Link href={`/admin/orders/${o.id}`} className="hover:underline">
                      #{o.id.slice(0, 6).toUpperCase()}
                    </Link>
                  </td>
                  <td className="p-3 text-ink-600 whitespace-nowrap">{formatDate(o.created_at)}</td>
                  <td className="p-3 text-ink-700">{o.seller?.store_name ?? '—'}</td>
                  <td className="p-3 text-ink-700">{o.delivery_full_name ?? '—'} <span className="text-ink-400">{o.delivery_city}</span></td>
                  <td className="p-3 text-ink-700">{o.rider?.full_name ?? <span className="text-ink-400">—</span>}</td>
                  <td className="p-3">
                    <OrderStatusBadge status={o.delivery_status} size="sm" />
                  </td>
                  <td className="p-3 text-right font-bold">{formatPrice(o.total_price)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-ink-400">Nessun ordine</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
