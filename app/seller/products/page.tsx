'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Copy, Trash2, Sparkles, Download, Plus, Pencil, SlidersHorizontal, X, Check, Package } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/EmptyState';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type SellerProductRow = {
  id: string;
  name: string;
  price: number | string;
  status: 'available' | 'sold' | string;
  images: string[] | null;
  stock: number | null;
  categories: { name: string | null } | null;
};

/** Tab di filtro sugli stati realmente usati dal catalogo. */
const TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'all',       label: 'Tutti',      match: () => true },
  { key: 'available', label: 'In vendita', match: (s) => s === 'available' },
  { key: 'sold',      label: 'Esauriti',   match: (s) => s === 'sold' },
  { key: 'draft',     label: 'Bozze',      match: (s) => s === 'draft' },
];

export default function SellerProductsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('all');

  const { data: products = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.products,
    queryFn: async (): Promise<SellerProductRow[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, status, images, stock, categories(name)')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SellerProductRow[];
    },
  });

  // "Venduti" reale: SOMMA(order_items.quantity) per gli ordini CONSEGNATI del
  // venditore, raggruppata per prodotto. Stessa forma del calcolo "venduto" della
  // dashboard (order_items + products!inner(seller_id)), filtrata a delivery_status
  // = DELIVERED. Una sola query aggregata; la mappa risultante alimenta la colonna.
  const { data: soldByProduct = {} } = useQuery({
    queryKey: [...queryKeys.seller.products, 'sold'],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};
      const { data, error } = await supabase
        .from('order_items')
        .select('product_id, quantity, products!inner(seller_id), orders!inner(delivery_status)')
        .eq('products.seller_id', user.id)
        .eq('orders.delivery_status', 'DELIVERED');
      if (error) throw error;
      const rows = (data ?? []) as unknown as { product_id: string | null; quantity: number }[];
      const map: Record<string, number> = {};
      for (const r of rows) {
        if (!r.product_id) continue;
        map[r.product_id] = (map[r.product_id] ?? 0) + Number(r.quantity);
      }
      return map;
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success('Prodotto eliminato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === 'available' ? 'sold' : 'available';
      const { error } = await supabase.from('products').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seller.products }),
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Modifica in blocco: prezzo + stock direttamente nella lista, salvati in un colpo.
  const bulkSave = useMutation({
    mutationFn: async (edits: Record<string, { price?: string; stock?: string }>) => {
      const ids = Object.keys(edits);
      for (const id of ids) {
        const e = edits[id];
        const patch: Record<string, number> = {};
        if (e.price != null && e.price !== '') {
          const n = Number(e.price.replace(',', '.'));
          if (Number.isFinite(n)) patch.price = n;
        }
        if (e.stock != null && e.stock !== '') {
          const n = Number(e.stock);
          if (Number.isFinite(n)) patch.stock = n;
        }
        if (Object.keys(patch).length === 0) continue;
        const { error } = await supabase.from('products').update(patch).eq('id', id);
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success(`${n} ${n === 1 ? 'prodotto aggiornato' : 'prodotti aggiornati'}`);
      setBulk(false);
      setEdits({});
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const askDelete = async (p: SellerProductRow) => {
    const ok = await confirmDialog({
      title: 'Eliminare il prodotto?',
      message: `"${p.name}" verrà rimosso dal tuo catalogo. L'azione è irreversibile.`,
      confirmLabel: 'Sì, elimina',
      danger: true,
      icon: Trash2,
    });
    if (ok) remove.mutate(p.id);
  };

  // Stato "modifica in blocco".
  const [bulk, setBulk] = useState(false);
  const [edits, setEdits] = useState<Record<string, { price?: string; stock?: string }>>({});
  const editCount = Object.keys(edits).filter((id) => {
    const e = edits[id];
    return (e.price != null && e.price !== '') || (e.stock != null && e.stock !== '');
  }).length;
  const setField = (id: string, k: 'price' | 'stock', v: string) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [k]: v } }));
  const valOf = (p: SellerProductRow, k: 'price' | 'stock'): string => {
    const e = edits[p.id];
    if (e && e[k] != null) return e[k] as string;
    return k === 'price' ? String(p.price).replace('.', ',') : String(p.stock ?? 0);
  };
  const cancelBulk = () => { setBulk(false); setEdits({}); };

  const list = useMemo(() => {
    const matcher = TABS.find((t) => t.key === tab) ?? TABS[0];
    return products.filter((p) => matcher.match(p.status));
  }, [products, tab]);

  if (isLoading) return <LoadingState />;

  return (
    <div className={bulk ? 'pb-24' : undefined}>
      <SellerPageTitle
        eyebrow="Catalogo"
        title="Prodotti"
        sub={`${products.length} ${products.length === 1 ? 'prodotto' : 'prodotti'} a catalogo`}
        action={
          <>
            {bulk ? (
              <Button variant="ghost" size="sm" icon={X} onClick={cancelBulk}>Annulla</Button>
            ) : (
              <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setBulk(true)}>
                Modifica in blocco
              </Button>
            )}
            <Button href="/seller/products/ai-batch" variant="secondary" size="sm">
              <Sparkles size={14} aria-hidden /> AI sul catalogo
            </Button>
            <Button href="/seller/products/import" variant="secondary" size="sm">
              <Download size={14} aria-hidden /> Importa CSV
            </Button>
            <Button href="/seller/products/new" size="sm" icon={Plus}>Nuovo prodotto</Button>
          </>
        }
      />

      {bulk && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-800">
          <SlidersHorizontal size={15} className="shrink-0 text-primary-700" aria-hidden />
          Modifica prezzo e scorte direttamente nella lista, poi salva tutto in una volta.
        </div>
      )}

      {/* Tab di stato */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={on}
              className={`rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                on
                  ? 'bg-primary-700 text-white'
                  : 'bg-white text-ink-600 ring-1 ring-inset ring-cream-300 hover:bg-cream-50'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {products.length === 0 ? (
        <Card variant="bordered" padding="none">
          <EmptyState
            icon={Package}
            title="Nessun prodotto a catalogo"
            description="Pubblica il tuo primo prodotto: bastano una foto e un prezzo."
            ctaLabel="Nuovo prodotto"
            ctaHref="/seller/products/new"
            secondaryLabel="Importa CSV"
            secondaryHref="/seller/products/import"
          />
        </Card>
      ) : list.length === 0 ? (
        <Card variant="bordered" padding="none">
          <EmptyState icon={Package} title="Nessun prodotto in questa vista" description="Cambia filtro per vedere gli altri prodotti." variant="compact" />
        </Card>
      ) : (
        <Card variant="bordered" padding="none">
          {/* DESKTOP: tabella con azioni-icona */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cream-300 bg-cream-50">
                  {(['Prodotto', 'Prezzo', 'Stock', 'Venduti', 'Stato', ''] as const).map((h, i) => (
                    <th
                      key={h || i}
                      className={`px-4 py-3 text-[11px] font-bold uppercase tracking-[0.03em] text-ink-500 ${
                        i > 0 && i < 5 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-b border-cream-200 last:border-0 hover:bg-cream-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-cream-100">
                          <Image
                            src={sizedImage(p.images?.[0] ?? 'https://placehold.co/100x100/eee/aaa?text=?', 'thumb')}
                            alt={p.name}
                            fill
                            sizes="44px"
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <Link href={`/product/${p.id}`} className="block truncate font-semibold text-ink-900 hover:text-primary-700">
                            {p.name}
                          </Link>
                          <p className="truncate text-xs text-ink-400">{p.categories?.name ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {bulk ? (
                        <input
                          value={valOf(p, 'price')}
                          onChange={(e) => setField(p.id, 'price', e.target.value)}
                          inputMode="decimal"
                          aria-label={`Prezzo di ${p.name}`}
                          className="w-20 rounded-md border border-cream-300 px-2 py-1.5 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-400"
                        />
                      ) : (
                        <span className="font-bold text-ink-900">{formatPrice(Number(p.price))}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      (p.stock ?? 0) === 0 ? 'text-secondary-600' : (p.stock ?? 0) <= 3 ? 'text-accent-700' : 'text-ink-700'
                    }`}>
                      {bulk ? (
                        <input
                          value={valOf(p, 'stock')}
                          onChange={(e) => setField(p.id, 'stock', e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          aria-label={`Stock di ${p.name}`}
                          className="w-20 rounded-md border border-cream-300 px-2 py-1.5 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-400"
                        />
                      ) : (
                        p.stock ?? 0
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-700">
                      {soldByProduct[p.id] ? soldByProduct[p.id] : <span className="font-normal text-ink-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={`/seller/products/${p.id}/edit`}
                          aria-label={`Modifica ${p.name}`}
                          title="Modifica"
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-500 hover:bg-cream-100 hover:text-primary-700"
                        >
                          <Pencil size={16} aria-hidden />
                        </Link>
                        <Link
                          href={`/seller/products/new?from=${p.id}`}
                          aria-label={`Duplica ${p.name}`}
                          title="Duplica"
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-500 hover:bg-cream-100 hover:text-ink-800"
                        >
                          <Copy size={16} aria-hidden />
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleStatus.mutate({ id: p.id, status: p.status })}
                          className="rounded-md px-2 py-1.5 text-xs font-semibold text-ink-600 hover:bg-cream-100 hover:text-ink-900"
                        >
                          {p.status === 'available' ? 'Disattiva' : 'Attiva'}
                        </button>
                        <button
                          type="button"
                          onClick={() => askDelete(p)}
                          aria-label={`Elimina ${p.name}`}
                          title="Elimina"
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-secondary-600 hover:bg-secondary-50"
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MOBILE: lista a card — azioni sempre visibili, niente scroll orizzontale */}
          <div className="divide-y divide-cream-200 md:hidden">
            {list.map((p) => (
              <div key={p.id} className="p-3.5">
                <div className="flex gap-3">
                  <Link href={`/product/${p.id}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream-100">
                    <Image
                      src={sizedImage(p.images?.[0] ?? 'https://placehold.co/100x100/eee/aaa?text=?', 'thumb')}
                      alt={p.name}
                      fill
                      sizes="64px"
                      unoptimized
                      className="object-cover"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/product/${p.id}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-primary-700">
                        {p.name}
                      </Link>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-ink-400">{p.categories?.name ?? '—'}</p>
                    {bulk ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-ink-500">
                          €
                          <input
                            value={valOf(p, 'price')}
                            onChange={(e) => setField(p.id, 'price', e.target.value)}
                            inputMode="decimal"
                            aria-label={`Prezzo di ${p.name}`}
                            className="w-20 rounded-md border border-cream-300 px-2 py-1 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-400"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-ink-500">
                          Stock
                          <input
                            value={valOf(p, 'stock')}
                            onChange={(e) => setField(p.id, 'stock', e.target.value.replace(/[^0-9]/g, ''))}
                            inputMode="numeric"
                            aria-label={`Stock di ${p.name}`}
                            className="w-16 rounded-md border border-cream-300 px-2 py-1 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-400"
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-bold text-ink-900">{formatPrice(Number(p.price))}</span>
                        <span className="text-xs text-ink-500">· {p.stock ?? 0} pz</span>
                        {soldByProduct[p.id] ? (
                          <span className="text-xs text-ink-500">· {soldByProduct[p.id]} venduti</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
                {!bulk && (
                  <div className="mt-3 flex items-center gap-2 border-t border-cream-100 pt-3">
                    <Link
                      href={`/seller/products/${p.id}/edit`}
                      className="flex-1 rounded-lg bg-primary-50 py-2 text-center text-sm font-semibold text-primary-700"
                    >
                      Modifica
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleStatus.mutate({ id: p.id, status: p.status })}
                      className="flex-1 rounded-lg bg-cream-100 py-2 text-center text-sm font-semibold text-ink-700"
                    >
                      {p.status === 'available' ? 'Disattiva' : 'Attiva'}
                    </button>
                    <Link
                      href={`/seller/products/new?from=${p.id}`}
                      aria-label="Duplica"
                      className="rounded-lg bg-cream-100 px-3 py-2 text-ink-700"
                    >
                      <Copy size={16} aria-hidden />
                    </Link>
                    <button
                      type="button"
                      onClick={() => askDelete(p)}
                      aria-label="Elimina"
                      className="rounded-lg bg-secondary-50 px-3 py-2 text-secondary-600"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Barra azioni "modifica in blocco" */}
      {bulk && (
        <div className="fixed inset-x-0 bottom-0 z-sticky flex items-center justify-between gap-3 border-t border-cream-300 bg-surface-0 px-5 py-3 shadow-warm-xl">
          <span className="text-sm text-ink-600">
            {editCount > 0 ? (
              <><strong className="text-ink-900">{editCount}</strong> {editCount === 1 ? 'prodotto modificato' : 'prodotti modificati'}</>
            ) : (
              'Nessuna modifica'
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancelBulk}>Annulla</Button>
            <Button
              size="sm"
              icon={Check}
              loading={bulkSave.isPending}
              disabled={editCount === 0}
              onClick={() => bulkSave.mutate(edits)}
            >
              Salva modifiche
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  available: { label: 'In vendita', cls: 'bg-olive-100 text-olive-700' },
  sold:      { label: 'Esaurito',   cls: 'bg-secondary-50 text-secondary-600' },
  draft:     { label: 'Bozza',      cls: 'bg-cream-200 text-ink-500' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: 'In approvazione', cls: 'bg-accent-100 text-accent-700' };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}
