'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, cartTotal, clearCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';

type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
};

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => setCart(getCart()), []);
  const total = cartTotal(cart);

  const [form, setForm] = useState<AddressForm>({
    fullName: '', address: '', city: '', zip: '', phone: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const placeOrder = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Devi essere autenticato per completare l\'ordine');
      if (cart.length === 0) throw new Error('Il carrello è vuoto');

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          total_price: total,
          payment_status: 'PENDING',
          delivery_status: 'PREPARATION',
        })
        .select()
        .single();
      if (orderError) throw orderError;

      const items = cart.map((item) => ({
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) throw itemsError;

      return order;
    },
    onSuccess: () => {
      clearCart();
      toast.success('Ordine effettuato con successo!');
      router.push('/orders');
    },
    onError: (err: any) => toast.error(err.message || 'Errore durante il checkout'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing = Object.entries(form).find(([, v]) => !v.trim());
    if (missing) {
      toast.error('Compila tutti i campi');
      return;
    }
    placeOrder.mutate();
  };

  if (cart.length === 0) {
    return (
      <div className="container mx-auto p-8 text-center space-y-4">
        <p className="text-gray-500 text-lg">Il tuo carrello è vuoto.</p>
        <a href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition-colors">
          Torna al negozio
        </a>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">Checkout</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Indirizzo di consegna</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { name: 'fullName', label: 'Nome e cognome', placeholder: 'Mario Rossi', type: 'text' },
              { name: 'address',  label: 'Indirizzo',       placeholder: 'Via Roma 1',   type: 'text' },
              { name: 'city',     label: 'Città',           placeholder: 'Piacenza',     type: 'text' },
              { name: 'zip',      label: 'CAP',             placeholder: '29121',        type: 'text' },
              { name: 'phone',    label: 'Telefono',        placeholder: '3331234567',   type: 'tel'  },
            ].map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                <input
                  type={field.type}
                  name={field.name}
                  value={form[field.name as keyof AddressForm]}
                  onChange={handleChange}
                  placeholder={field.placeholder}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            ))}

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              💳 Il pagamento avverrà in contanti alla consegna.
            </div>

            <button
              type="submit"
              disabled={placeOrder.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors"
            >
              {placeOrder.isPending ? 'Elaborazione...' : `Conferma ordine · ${formatPrice(total)}`}
            </button>
          </form>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Riepilogo ordine</h2>
          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="divide-y">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-center px-5 py-3">
                  <div>
                    <p className="font-medium text-gray-800">{item.name}</p>
                    <p className="text-sm text-gray-400">×{item.quantity}</p>
                  </div>
                  <span className="font-semibold text-gray-800">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="bg-gray-50 border-t px-5 py-4 flex justify-between items-center">
              <span className="font-bold text-gray-700">Totale</span>
              <span className="text-xl font-bold text-indigo-700">{formatPrice(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
