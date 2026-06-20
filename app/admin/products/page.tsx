'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { AdminPageTitle } from '@/components/admin/AdminUI';

type Row = {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  status: string;
  images: string[] | null;
  external_marketplace: string | null;
  external_synced_at: string | null;
  seller: { store_name: string | null } | null;
  categories: { name: string | null } | null;
};

export default function AdminProductsPage() {
  const qc = useQueryClient();
  const tConfirm = useTranslations('confirm');
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.products,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, price, stock, status, images, external_marketplace, external_synced_at,
          seller:profiles!products_seller_id_fkey ( store_name ),
          categories ( name )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.products });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success('Prodotto eliminato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const filtered = products.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.name.toLowerCase().includes(s) || p.seller?.store_name?.toLowerCase().includes(s);
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <AdminPageTitle
        eyebrow="Catalogo"
        title="Prodotti"
        sub={`${filtered.length} di ${products.length}`}
        action={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="search"
              placeholder="Cerca prodotto o negozio…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-cream-300 rounded-lg px-3 py-1.5 text-sm flex-1 sm:w-64"
            />
            <Link
              href="/admin/products/new"
              className="inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
            >
              <Plus size={16} aria-hidden /> Nuovo
            </Link>
          </div>
        }
      />

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Prodotto</th>
              <th className="p-3 text-left">Negozio</th>
              <th className="p-3 text-left">Categoria</th>
              <th className="p-3 text-right">Prezzo</th>
              <th className="p-3 text-right">Stock</th>
              <th className="p-3 text-left">Stato</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const img = p.images?.[0];
              return (
                <tr key={p.id} className="border-t hover:bg-cream-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-cream-100 overflow-hidden shrink-0">
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/admin/products/${p.id}/edit`} className="font-medium text-ink-900 hover:text-primary-700 hover:underline block truncate">
                          {p.name}
                        </Link>
                        {p.external_marketplace && (
                          <span className="inline-block mt-0.5 rounded-full bg-accent-100 text-accent-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                            import · {p.external_marketplace}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-ink-700">{p.seller?.store_name ?? '—'}</td>
                  <td className="p-3 text-ink-600">{p.categories?.name ?? '—'}</td>
                  <td className="p-3 text-right font-semibold">{formatPrice(p.price)}</td>
                  <td className="p-3 text-right">{p.stock ?? 0}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                      p.status === 'available' ? 'bg-olive-100 text-olive-700' :
                      p.status === 'sold'      ? 'bg-cream-100 text-ink-600' :
                                                  'bg-accent-100 text-accent-700'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/admin/products/${p.id}/edit`}
                        className="text-xs bg-cream-100 hover:bg-cream-200 text-ink-700 px-2 py-1 rounded"
                      >
                        Modifica
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: 'Eliminare il prodotto?',
                            message: `"${p.name}" verrà rimosso definitivamente.`,
                            confirmLabel: tConfirm('yesDelete'),
                            danger: true,
                            icon: Trash2,
                          });
                          if (ok) remove.mutate(p.id);
                        }}
                        className="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 px-2 py-1 rounded"
                      >
                        Elimina
                      </button>
                    </div>
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
