'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Zap, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { formatPrice } from '@/lib/format';

/**
 * Admin: Drop del giorno. La tabella daily_drops esisteva senza interfaccia: qui
 * l'admin crea/modifica/elimina l'offerta del giorno. Lettura via SELECT pubblica;
 * scrittura via /api/admin/daily-drops (service-role).
 */

type Product = { id: string; name: string; price: number };
type Drop = {
  id: string; drop_date: string; discount_percent: number; original_price: number;
  drop_price: number; headline: string | null; product: { id: string; name: string } | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

async function authedFetch(url: string, method: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore');
  return json;
}

export default function AdminDailyDropsPage() {
  const qc = useQueryClient();

  const [productId, setProductId] = useState('');
  const [dropDate, setDropDate] = useState(todayIso());
  const [discountPct, setDiscountPct] = useState(20);
  const [headline, setHeadline] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['admin', 'drop-products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('status', 'available')
        .order('name')
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const { data: drops = [] } = useQuery({
    queryKey: queryKeys.admin.dailyDrops,
    queryFn: async (): Promise<Drop[]> => {
      const { data, error } = await supabase
        .from('daily_drops')
        .select('id, drop_date, discount_percent, original_price, drop_price, headline, product:products(id, name)')
        .gte('drop_date', todayIso())
        .order('drop_date');
      if (error) throw error;
      return (data ?? []) as unknown as Drop[];
    },
  });

  const selected = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const originalPrice = selected ? Number(selected.price) : 0;
  const dropPrice = originalPrice > 0 ? Number((originalPrice * (1 - discountPct / 100)).toFixed(2)) : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error('Seleziona un prodotto');
      if (originalPrice <= 0) throw new Error('Il prodotto non ha un prezzo valido');
      await authedFetch('/api/admin/daily-drops', 'POST', {
        product_id: productId,
        drop_date: dropDate,
        discount_percent: discountPct,
        original_price: originalPrice,
        drop_price: dropPrice,
        headline: headline.trim(),
      });
    },
    onSuccess: () => {
      toast.success('Drop salvato!');
      qc.invalidateQueries({ queryKey: queryKeys.admin.dailyDrops });
      qc.invalidateQueries({ queryKey: queryKeys.home.dailyDrop(dropDate) });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (date: string) => { await authedFetch('/api/admin/daily-drops', 'DELETE', { drop_date: date }); },
    onSuccess: (_d, date) => {
      toast.success('Drop eliminato');
      qc.invalidateQueries({ queryKey: queryKeys.admin.dailyDrops });
      qc.invalidateQueries({ queryKey: queryKeys.home.dailyDrop(date) });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-8">
      <header>
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-primary-700 transition-colors">
          <ArrowLeft size={15} aria-hidden /> Dashboard admin
        </Link>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2 mt-1">
          <Zap size={22} className="text-accent-500" strokeWidth={2.2} />
          Drop del giorno
        </h1>
        <p className="text-sm text-ink-500 mt-1">Imposta l&apos;offerta del giorno mostrata in home (un drop per data). Si auto-nasconde se per oggi non c&apos;è nulla.</p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="bg-white border border-cream-300 rounded-xl p-6 space-y-4">
        <Select label="Prodotto" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— Seleziona —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {formatPrice(Number(p.price))}</option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Data" type="date" value={dropDate} min={todayIso()} onChange={(e) => setDropDate(e.target.value)} />
          <Input label="Sconto (%)" type="number" min={5} max={70} value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value) || 0)} />
        </div>

        {selected && (
          <div className="rounded-lg bg-cream-50 border border-cream-200 px-4 py-3 text-sm text-ink-700">
            Prezzo pieno <strong>{formatPrice(originalPrice)}</strong> → prezzo drop{' '}
            <strong className="text-primary-700">{formatPrice(dropPrice)}</strong> (-{discountPct}%)
          </div>
        )}

        <Textarea label="Headline (opzionale)" value={headline} rows={2} maxLength={200} onChange={(e) => setHeadline(e.target.value)} placeholder="Es: La salumeria che riscopre i sapori dimenticati" />

        <Button type="submit" loading={save.isPending}>Salva drop</Button>
      </form>

      <section>
        <h2 className="font-bold text-ink-900 mb-3">Drop programmati</h2>
        {drops.length === 0 ? (
          <p className="text-sm text-ink-500">Nessun drop per oggi o per i prossimi giorni.</p>
        ) : (
          <ul className="space-y-2">
            {drops.map((d) => (
              <li key={d.id} className="bg-white border border-cream-200 rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900 text-sm truncate">
                    {new Date(d.drop_date).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' })} · {d.product?.name ?? '—'}
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatPrice(Number(d.drop_price))} (-{d.discount_percent}%){d.headline ? ` · ${d.headline}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Eliminare questo drop?')) remove.mutate(d.drop_date); }}
                  aria-label="Elimina drop"
                  className="p-2 text-ink-400 hover:text-red-600"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
