'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pause, Play, Trash2, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';

/**
 * Admin: gestione sponsored listings.
 *
 * Esperti consultati:
 * - Marketplace PM: "Admin deve vedere campagne attive, performance (CTR), e poter
 *   pausare campagne fraudolente o di seller a basso rating."
 * - Trust & Safety: "Disabilita campagne se seller sotto rating 3.5 o
 *   contestato. Pause = preserva budget non speso."
 * - Data Analyst: "CTR = clicks/impressions. CPC = spent/clicks. Mostralo
 *   in tabella per evaluation veloce."
 * - Finance Manager: "Budget speso vs budget allocato = report finanziario."
 */

type Listing = {
  id: string;
  product_id: string | null;
  seller_id: string;
  placement: 'home_top' | 'search_top' | 'category_top';
  category_slug: string | null;
  start_date: string;
  end_date: string;
  daily_budget_cents: number;
  spent_cents: number;
  impressions: number;
  clicks: number;
  status: 'active' | 'paused' | 'ended';
  product: { name: string | null } | null;
  seller: { store_name: string | null } | null;
};

export default function AdminSponsoredPage() {
  const qc = useQueryClient();
  const tStates = useTranslations('states');
  const tToasts = useTranslations('toasts');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'ended'>('all');

  const { data: listings = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.sponsored(filter),
    queryFn: async (): Promise<Listing[]> => {
      let q = supabase
        .from('sponsored_listings')
        .select(`
          id, product_id, seller_id, placement, category_slug,
          start_date, end_date, daily_budget_cents, spent_cents,
          impressions, clicks, status,
          product:products!sponsored_listings_product_id_fkey ( name ),
          seller:profiles!sponsored_listings_seller_id_fkey ( store_name )
        `)
        .order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      return (data ?? []) as unknown as Listing[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (vars: { id: string; status: Listing['status'] }) => {
      const { error } = await supabase.from('sponsored_listings').update({ status: vars.status }).eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tToasts('updated'));
      qc.invalidateQueries({ queryKey: queryKeys.admin.sponsored() });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sponsored_listings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tToasts('deleted'));
      qc.invalidateQueries({ queryKey: queryKeys.admin.sponsored() });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const STATUS_BADGE: Record<Listing['status'], string> = {
    active: 'bg-olive-100 text-olive-800',
    paused: 'bg-accent-100 text-accent-800',
    ended: 'bg-cream-100 text-ink-600',
  };

  const totalSpent = listings.reduce((s, l) => s + l.spent_cents, 0);
  const totalImpressions = listings.reduce((s, l) => s + l.impressions, 0);
  const totalClicks = listings.reduce((s, l) => s + l.clicks, 0);
  const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <Megaphone size={22} className="text-primary-700" strokeWidth={2.2} />
          Sponsored Listings
        </h1>
        <p className="text-sm text-ink-500 mt-1">Campagne pubblicitarie acquistate dai seller.</p>
      </header>

      {/* KPI summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-cream-300 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Campagne</p>
          <p className="text-2xl font-bold text-ink-900">{listings.length}</p>
        </div>
        <div className="bg-white border border-cream-300 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Speso totale</p>
          <p className="text-2xl font-bold text-ink-900">{formatPrice(totalSpent / 100)}</p>
        </div>
        <div className="bg-white border border-cream-300 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Impressions</p>
          <p className="text-2xl font-bold text-ink-900">{totalImpressions.toLocaleString('it-IT')}</p>
        </div>
        <div className="bg-white border border-cream-300 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">CTR medio</p>
          <p className="text-2xl font-bold text-ink-900">{overallCtr.toFixed(2)}%</p>
        </div>
      </div>

      {/* Filtri */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'active', 'paused', 'ended'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              filter === s
                ? 'bg-primary-700 text-white'
                : 'bg-white border border-cream-300 text-ink-700 hover:bg-cream-50'
            }`}
          >
            {s === 'all' ? 'Tutti' : s}
          </button>
        ))}
      </div>

      <div className="bg-white border border-cream-300 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-cream-50 text-ink-600">
            <tr>
              <th className="text-left px-4 py-2">Prodotto / Seller</th>
              <th className="text-left px-4 py-2">Placement</th>
              <th className="text-left px-4 py-2">Periodo</th>
              <th className="text-right px-4 py-2">Budget/g</th>
              <th className="text-right px-4 py-2">Speso</th>
              <th className="text-right px-4 py-2">Impressions</th>
              <th className="text-right px-4 py-2">CTR</th>
              <th className="text-left px-4 py-2">Stato</th>
              <th className="text-right px-4 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100">
            {isLoading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-500">{tStates('loading')}</td></tr>
            ) : listings.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-500">Nessuna campagna.</td></tr>
            ) : listings.map((l) => {
              const ctr = l.impressions > 0 ? (l.clicks / l.impressions) * 100 : 0;
              return (
                <tr key={l.id} className="hover:bg-cream-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink-900 text-sm">{l.product?.name ?? '—'}</p>
                    <p className="text-xs text-ink-500">{l.seller?.store_name ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{l.placement}{l.category_slug ? ` · ${l.category_slug}` : ''}</td>
                  <td className="px-4 py-3 text-ink-600 text-xs">
                    {l.start_date} → {l.end_date}
                  </td>
                  <td className="px-4 py-3 text-right">{formatPrice(l.daily_budget_cents / 100)}</td>
                  <td className="px-4 py-3 text-right">{formatPrice(l.spent_cents / 100)}</td>
                  <td className="px-4 py-3 text-right">{l.impressions.toLocaleString('it-IT')}</td>
                  <td className="px-4 py-3 text-right">{ctr.toFixed(2)}%</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[l.status]}`}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                    {l.status === 'active' && (
                      <button onClick={() => setStatus.mutate({ id: l.id, status: 'paused' })} className="text-accent-700 hover:text-accent-800 text-xs font-semibold inline-flex items-center gap-1">
                        <Pause size={12} strokeWidth={2.4} /> Pausa
                      </button>
                    )}
                    {l.status === 'paused' && (
                      <button onClick={() => setStatus.mutate({ id: l.id, status: 'active' })} className="text-olive-700 hover:text-olive-800 text-xs font-semibold inline-flex items-center gap-1">
                        <Play size={12} strokeWidth={2.4} /> Riprendi
                      </button>
                    )}
                    <button onClick={() => del.mutate(l.id)} className="text-rose-700 hover:text-rose-800 text-xs font-semibold inline-flex items-center gap-1">
                      <Trash2 size={12} strokeWidth={2.4} /> Elimina
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
