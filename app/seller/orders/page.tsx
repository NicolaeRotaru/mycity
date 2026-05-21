'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice, formatDate } from '@/lib/format';

const statusOptions = ['PREPARATION', 'SHIPPED', 'DELIVERED'] as const;
const statusLabels: Record<string, string> = {
  PREPARATION: '📦 Preparazione',
  SHIPPED:     '🚚 Spedito',
  DELIVERED:   '✅ Consegnato',
};

export default function SellerOrdersPage() {
  const qc = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['seller-orders'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const { data, error } = await supabase
        .from('order_items')
        .select(`
          id, quantity, unit_price,
          products!inner ( name, seller_id ),
          orders ( id, total_price, delivery_status, payment_status, created_at, user_id )
        `)
        .eq('products.seller_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase
        .from('orders')
        .update({ delivery_status: status })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-orders'] });
      toast.success('Stato aggiornato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ordini ricevuti</h1>

      {orders.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
          Non hai ancora ricevuto ordini.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3 text-left">Ordine</th>
                <th className="p-3 text-left">Data</th>
                <th className="p-3 text-left">Prodotto</th>
                <th className="p-3 text-left">Quantità</th>
                <th className="p-3 text-left">Importo</th>
                <th className="p-3 text-left">Stato consegna</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((it: any) => (
                <tr key={it.id} className="border-t">
                  <td className="p-3 font-mono text-xs">
                    #{it.orders?.id?.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="p-3">
                    {it.orders?.created_at ? formatDate(it.orders.created_at) : '—'}
                  </td>
                  <td className="p-3">{it.products?.name}</td>
                  <td className="p-3">×{it.quantity}</td>
                  <td className="p-3 font-semibold">
                    {formatPrice(Number(it.unit_price) * it.quantity)}
                  </td>
                  <td className="p-3">
                    <select
                      value={it.orders?.delivery_status ?? 'PREPARATION'}
                      onChange={(e) =>
                        updateStatus.mutate({ orderId: it.orders!.id, status: e.target.value })
                      }
                      className="border rounded px-2 py-1 text-sm"
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>{statusLabels[s]}</option>
                      ))}
                    </select>
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
