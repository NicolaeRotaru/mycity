'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

export default function SellerProductsPage() {
  const qc = useQueryClient();

  type SellerProductRow = {
    id: string;
    name: string;
    price: number | string;
    status: 'available' | 'sold' | string;
    images: string[] | null;
    stock: number | null;
    categories: { name: string | null } | null;
  };

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

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-2xl font-serif font-bold text-ink-900">I tuoi prodotti</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/seller/products/import" className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:border-primary-300 text-ink-900 px-4 py-2 rounded-lg font-semibold text-sm">
            <span>📥</span> Importa CSV
          </Link>
          <Button href="/seller/products/new" size="sm">➕ Nuovo prodotto</Button>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-ink-500">
          Non hai ancora pubblicato prodotti.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-cream-50 border-b">
              <tr>
                <th className="text-left p-3">Prodotto</th>
                <th className="text-left p-3">Categoria</th>
                <th className="text-left p-3">Prezzo</th>
                <th className="text-left p-3">Stock</th>
                <th className="text-left p-3">Stato</th>
                <th className="text-right p-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t hover:bg-cream-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 bg-cream-100 rounded shrink-0">
                        <Image
                          src={sizedImage(p.images?.[0] ?? 'https://placehold.co/100x100/eee/aaa?text=?', 'thumb')}
                          alt={p.name}
                          fill
                          sizes="48px"
                          unoptimized
                          className="object-cover rounded"
                        />
                      </div>
                      <Link href={`/product/${p.id}`} className="font-semibold hover:text-primary-700">
                        {p.name}
                      </Link>
                    </div>
                  </td>
                  <td className="p-3">{p.categories?.name ?? '—'}</td>
                  <td className="p-3 font-semibold">{formatPrice(Number(p.price))}</td>
                  <td className="p-3">{p.stock ?? 0}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      p.status === 'available' ? 'bg-olive-100 text-olive-700' :
                      p.status === 'sold'      ? 'bg-cream-200 text-ink-700' :
                                                 'bg-accent-100 text-accent-700'
                    }`}>
                      {p.status === 'available' ? 'In vendita' : p.status === 'sold' ? 'Esaurito' : 'In approvazione'}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <Link
                      href={`/seller/products/${p.id}/edit`}
                      className="text-primary-700 hover:underline font-semibold"
                    >
                      Modifica
                    </Link>
                    <button
                      onClick={() => toggleStatus.mutate({ id: p.id, status: p.status })}
                      className="text-ink-700 hover:underline"
                    >
                      {p.status === 'available' ? 'Disattiva' : 'Attiva'}
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Eliminare il prodotto?',
                          message: `"${p.name}" verrà rimosso dal tuo catalogo. L'azione è irreversibile.`,
                          confirmLabel: 'Sì, elimina',
                          danger: true,
                          icon: '🗑️',
                        });
                        if (ok) remove.mutate(p.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
