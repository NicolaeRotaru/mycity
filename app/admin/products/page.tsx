'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { confirmDialog } from '@/components/ConfirmDialog';

type Row = {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  status: string;
  images: string[] | null;
  seller: { store_name: string | null } | null;
  categories: { name: string | null } | null;
};

export default function AdminProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, price, stock, status, images,
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
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Prodotto eliminato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = products.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.name.toLowerCase().includes(s) || p.seller?.store_name?.toLowerCase().includes(s);
  });

  if (isLoading) return <div className="text-center py-8 text-gray-500">Caricamento...</div>;

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prodotti</h1>
          <p className="text-sm text-gray-500">{filtered.length} di {products.length}</p>
        </div>
        <input
          type="search"
          placeholder="Cerca prodotto o negozio…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-full sm:w-64"
        />
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-gray-50 border-b text-xs uppercase tracking-wide text-gray-500">
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
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0">
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <span className="font-medium text-gray-900">{p.name}</span>
                    </div>
                  </td>
                  <td className="p-3 text-gray-700">{p.seller?.store_name ?? '—'}</td>
                  <td className="p-3 text-gray-600">{p.categories?.name ?? '—'}</td>
                  <td className="p-3 text-right font-semibold">{formatPrice(p.price)}</td>
                  <td className="p-3 text-right">{p.stock ?? 0}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                      p.status === 'available' ? 'bg-emerald-100 text-emerald-700' :
                      p.status === 'sold'      ? 'bg-gray-100 text-gray-600' :
                                                  'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Eliminare il prodotto?',
                          message: `"${p.name}" verrà rimosso definitivamente.`,
                          confirmLabel: 'Sì, elimina',
                          danger: true,
                          icon: '🗑️',
                        });
                        if (ok) remove.mutate(p.id);
                      }}
                      className="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 px-2 py-1 rounded"
                    >
                      Elimina
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
