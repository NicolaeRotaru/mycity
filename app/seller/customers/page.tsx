'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice, formatDate } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

type CustomerRow = {
  userId: string;
  fullName: string | null;
  totalSpent: number;
  ordersCount: number;
  lastOrderAt: string;
  lastOrderId: string;
  firstOrderAt: string;
};

const filters = [
  { key: 'all',      label: 'Tutti' },
  { key: 'vip',      label: 'VIP (5+ ordini)' },
  { key: 'recent',   label: 'Ultimi 30 giorni' },
  { key: 'inactive', label: 'Inattivi 30+ giorni' },
] as const;

export default function SellerCustomersPage() {
  const [filter, setFilter] = useState<typeof filters[number]['key']>('all');
  const [search, setSearch] = useState('');

  const { data: customers = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.customers,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const { data: orders } = await supabase
        .from('orders')
        .select(`
          id, user_id, total_price, created_at,
          buyer:profiles!orders_user_id_fkey ( full_name )
        `)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });

      const byUser = new Map<string, CustomerRow>();
      type OrderRow = { id: string; user_id: string | null; total_price: number; created_at: string; buyer: { full_name: string | null } | null };
      for (const o of (orders ?? []) as unknown as OrderRow[]) {
        if (!o.user_id) continue;
        const existing = byUser.get(o.user_id);
        if (existing) {
          existing.totalSpent += Number(o.total_price);
          existing.ordersCount += 1;
          existing.firstOrderAt = o.created_at;
        } else {
          byUser.set(o.user_id, {
            userId:     o.user_id,
            fullName:   o.buyer?.full_name ?? null,
            totalSpent: Number(o.total_price),
            ordersCount: 1,
            lastOrderAt: o.created_at,
            lastOrderId: o.id,
            firstOrderAt: o.created_at,
          });
        }
      }
      return Array.from(byUser.values()).sort((a, b) => b.totalSpent - a.totalSpent);
    },
  });

  const filtered = customers.filter((c) => {
    if (search) {
      const s = search.toLowerCase();
      if (!c.fullName?.toLowerCase().includes(s)) return false;
    }
    const daysAgo = (date: string) => (Date.now() - new Date(date).getTime()) / 86400000;
    if (filter === 'vip') return c.ordersCount >= 5;
    if (filter === 'recent') return daysAgo(c.lastOrderAt) <= 30;
    if (filter === 'inactive') return daysAgo(c.lastOrderAt) > 30;
    return true;
  });

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const avgOrderValue = customers.length > 0
    ? customers.reduce((s, c) => s + c.totalSpent / c.ordersCount, 0) / customers.length
    : 0;

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">I tuoi clienti</h1>
        <p className="text-sm text-ink-500">{customers.length} clienti totali · {formatPrice(totalRevenue)} di ricavi</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-primary-700">{customers.length}</p>
          <p className="text-xs text-ink-500 uppercase tracking-wide">Totali</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-accent-600">
            {customers.filter((c) => c.ordersCount >= 5).length}
          </p>
          <p className="text-xs text-ink-500 uppercase tracking-wide">VIP</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-olive-600">{formatPrice(avgOrderValue)}</p>
          <p className="text-xs text-ink-500 uppercase tracking-wide">Ordine medio</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${
              filter === f.key ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Cerca nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-none sm:w-56"
        />
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Cliente</th>
              <th className="p-3 text-right">Ordini</th>
              <th className="p-3 text-right">Totale speso</th>
              <th className="p-3 text-left">Ultimo ordine</th>
              <th className="p-3 text-left">Tag</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-ink-400">Nessun cliente</td></tr>
            ) : (
              filtered.map((c) => {
                const daysAgo = Math.floor((Date.now() - new Date(c.lastOrderAt).getTime()) / 86400000);
                const isVip = c.ordersCount >= 5;
                const isInactive = daysAgo > 30;
                return (
                  <tr key={c.userId} className="border-t hover:bg-cream-50">
                    <td className="p-3">
                      <p className="font-semibold text-ink-900">{c.fullName ?? 'Cliente'}</p>
                      <p className="text-xs text-ink-400">ID: {c.userId.slice(0, 8)}…</p>
                    </td>
                    <td className="p-3 text-right font-bold">{c.ordersCount}</td>
                    <td className="p-3 text-right font-semibold text-olive-700">{formatPrice(c.totalSpent)}</td>
                    <td className="p-3 text-ink-600 whitespace-nowrap">
                      {formatDate(c.lastOrderAt)}
                      <p className="text-xs text-ink-400">{daysAgo} giorni fa</p>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {isVip && <span className="bg-accent-100 text-accent-700 text-xs font-semibold px-2 py-0.5 rounded-full">⭐ VIP</span>}
                        {isInactive && <span className="bg-rose-100 text-rose-700 text-xs font-semibold px-2 py-0.5 rounded-full">😴 Inattivo</span>}
                        {!isInactive && !isVip && <span className="bg-olive-100 text-olive-700 text-xs font-semibold px-2 py-0.5 rounded-full">Attivo</span>}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-900">
        💡 <strong>Suggerimento</strong>: i clienti VIP valgono in media 4× di più. Considera di mandare loro un'offerta esclusiva.
      </div>
    </div>
  );
}
