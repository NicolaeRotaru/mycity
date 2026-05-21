'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, cartTotal, clearCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

type AddressForm = { fullName: string; address: string; city: string; zip: string; phone: string; };

const Step = ({ num, label, active, done }: { num: number; label: string; active?: boolean; done?: boolean }) => (
  <div className="flex items-center gap-2">
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
        done ? 'bg-emerald-500 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
      }`}
    >
      {done ? '✓' : num}
    </div>
    <span className={`text-sm font-semibold ${active ? 'text-indigo-700' : done ? 'text-emerald-700' : 'text-gray-400'}`}>
      {label}
    </span>
  </div>
);

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => setCart(getCart()), []);

  const subtotal = cartTotal(cart);
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const shippingCost = freeShipping ? 0 : 4.9;
  const finalTotal = subtotal + shippingCost;

  const [form, setForm] = useState<AddressForm>({ fullName: '', address: '', city: '', zip: '', phone: '' });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const placeOrder = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Devi essere autenticato per completare l\'ordine');
      if (cart.length === 0) throw new Error('Il carrello è vuoto');

      const { data: order, error: orderError } = await supabase.from('orders').insert({
        user_id: user.id, total_price: finalTotal, payment_status: 'PENDING', delivery_status: 'PREPARATION',
      }).select().single();
      if (orderError) throw orderError;

      const items = cart.map((item) => ({
        order_id: order.id, product_id: item.id, quantity: item.quantity, unit_price: item.price,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) throw itemsError;
      return order;
    },
    onSuccess: () => {
      clearCart();
      toast.success('Ordine effettuato con successo! 🎉');
      router.push('/orders');
    },
    onError: (err: any) => toast.error(err.message || 'Errore durante il checkout'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.entries(form).find(([, v]) => !v.trim())) {
      toast.error('Compila tutti i campi');
      return;
    }
    placeOrder.mutate();
  };

  if (cart.length === 0) return (
    <div className="container mx-auto p-12 text-center space-y-4">
      <p className="text-gray-500 text-lg">Il tuo carrello è vuoto.</p>
      <Link href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg">
        Torna al negozio
      </Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-4 sm:gap-8 mb-8 flex-wrap">
        <Step num={1} label="Carrello" done />
        <div className="w-8 sm:w-16 h-px bg-gray-300" />
        <Step num={2} label="Indirizzo" active />
        <div className="w-8 sm:w-16 h-px bg-gray-300" />
        <Step num={3} label="Conferma" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNA SX */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border rounded-xl p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">📍 Indirizzo di consegna</h2>
            <form onSubmit={handleSubmit} className="space-y-4" id="checkout-form">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome e cognome</label>
                <input
                  type="text" name="fullName" value={form.fullName} onChange={handleChange}
                  placeholder="Mario Rossi"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Indirizzo</label>
                <input
                  type="text" name="address" value={form.address} onChange={handleChange}
                  placeholder="Via Roma 1"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Città</label>
                  <input
                    type="text" name="city" value={form.city} onChange={handleChange}
                    placeholder="Piacenza"
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CAP</label>
                  <input
                    type="text" name="zip" value={form.zip} onChange={handleChange}
                    placeholder="29121"
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
                <input
                  type="tel" name="phone" value={form.phone} onChange={handleChange}
                  placeholder="3331234567"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <p className="text-xs text-gray-400 mt-1">Ti chiameremo solo per coordinare la consegna</p>
              </div>
            </form>
          </div>

          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4">💳 Metodo di pagamento</h2>
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex items-start gap-3">
              <input type="radio" checked readOnly className="mt-1" />
              <div>
                <p className="font-bold text-gray-900">Contanti alla consegna</p>
                <p className="text-sm text-gray-600">Paghi quando ricevi il pacco. Niente carte di credito, niente rischi.</p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-3">
            <div className="text-3xl">🔒</div>
            <div className="text-sm">
              <p className="font-bold text-emerald-900 mb-1">Acquisto sicuro al 100%</p>
              <p className="text-emerald-800">
                I tuoi dati sono protetti. Riceverai una conferma via email entro pochi minuti dall'ordine.
              </p>
            </div>
          </div>
        </div>

        {/* COLONNA DX */}
        <div className="lg:sticky lg:top-32 h-fit space-y-4">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b px-5 py-3 flex justify-between items-center">
              <h2 className="font-bold">Riepilogo ordine</h2>
              <span className="text-xs text-gray-400">{cart.length} articoli</span>
            </div>
            <div className="divide-y max-h-72 overflow-y-auto">
              {cart.map((item) => (
                <div key={item.id} className="flex gap-3 items-center px-5 py-3">
                  <div className="relative w-12 h-12 bg-gray-100 rounded shrink-0 overflow-hidden">
                    <Image
                      src={item.image ?? 'https://placehold.co/100x100/eef2ff/6366f1?text=?'}
                      alt={item.name}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">×{item.quantity}</p>
                  </div>
                  <span className="font-semibold text-gray-800 text-sm">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 space-y-2 border-t bg-gray-50/50 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Spedizione</span>
                <span className={`font-semibold ${freeShipping ? 'text-emerald-600' : ''}`}>
                  {freeShipping ? 'GRATUITA' : formatPrice(shippingCost)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t font-bold text-lg">
                <span>Totale</span>
                <span className="text-indigo-700">{formatPrice(finalTotal)}</span>
              </div>
            </div>
            <button
              type="submit"
              form="checkout-form"
              disabled={placeOrder.isPending}
              className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 py-4 font-extrabold text-base transition-colors shadow-lg"
            >
              {placeOrder.isPending ? 'Elaborazione...' : `✓ Conferma ordine · ${formatPrice(finalTotal)}`}
            </button>
          </div>

          <div className="bg-white border rounded-xl p-4 text-xs text-gray-500 space-y-2">
            <p className="flex items-center gap-2"><span>🚚</span> Spedizione in 24-48 ore lavorative</p>
            <p className="flex items-center gap-2"><span>↩️</span> Reso gratuito entro 14 giorni</p>
            <p className="flex items-center gap-2"><span>📞</span> Assistenza dedicata 7/7</p>
          </div>
        </div>
      </div>
    </div>
  );
}
