'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, clearCart, removeFromCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { notify } from '@/lib/notifications';

type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

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

const SHIPPING_PER_ORDER = 4.9;

const SHIPPING_COST_FOR = (subtotal: number) => (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_PER_ORDER);

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => setCart(getCart()), []);

  // Raggruppa il carrello per seller. Usa il sellerId gia' presente nel CartItem
  // (formato nuovo). Per gli item vecchi senza sellerId, fa un lookup sui products.
  const { data: cartData, isLoading: loadingGroups } = useQuery({
    queryKey: ['checkout-groups', cart.map((c) => `${c.id}:${c.sellerId ?? ''}`).join(',')],
    enabled: cart.length > 0,
    queryFn: async () => {
      const itemsMissingSeller = cart.filter((c) => !c.sellerId);

      // Lookup solo per gli item legacy senza sellerId
      const lookupMap = new Map<string, string>(); // productId → sellerId
      const sellerNames = new Map<string, string>(); // sellerId → store_name

      if (itemsMissingSeller.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('products')
          .select('id, seller_id')
          .in('id', itemsMissingSeller.map((c) => c.id));
        if (pErr) throw pErr;
        for (const p of products ?? []) {
          if (p.seller_id) lookupMap.set(p.id, p.seller_id);
        }
      }

      // Recupera i nomi dei negozi (sia per quelli embedded che looked-up)
      const allSellerIds = Array.from(
        new Set([
          ...cart.map((c) => c.sellerId).filter(Boolean) as string[],
          ...Array.from(lookupMap.values()),
        ]),
      );
      if (allSellerIds.length > 0) {
        const { data: sellers } = await supabase
          .from('profiles')
          .select('id, store_name')
          .in('id', allSellerIds);
        for (const s of sellers ?? []) {
          sellerNames.set(s.id, s.store_name ?? 'Negozio');
        }
      }

      // Raggruppa
      const sellerMap = new Map<string, {
        sellerId: string;
        storeName: string;
        items: CartItem[];
      }>();
      const orphanItems: CartItem[] = [];

      for (const item of cart) {
        const sellerId = item.sellerId ?? lookupMap.get(item.id);
        if (!sellerId) {
          orphanItems.push(item);
          continue;
        }
        if (!sellerMap.has(sellerId)) {
          sellerMap.set(sellerId, {
            sellerId,
            storeName: sellerNames.get(sellerId) ?? item.storeName ?? 'Negozio',
            items: [],
          });
        }
        sellerMap.get(sellerId)!.items.push(item);
      }

      return { groups: Array.from(sellerMap.values()), orphans: orphanItems };
    },
  });

  const groups = cartData?.groups ?? [];
  const orphans = cartData?.orphans ?? [];

  const groupSubtotal = (g: { items: CartItem[] }) =>
    g.items.reduce((s, it) => s + it.price * it.quantity, 0);

  const grandSubtotal = groups.reduce((s, g) => s + groupSubtotal(g), 0);
  const grandShipping = groups.reduce((s, g) => s + SHIPPING_COST_FOR(groupSubtotal(g)), 0);
  const grandTotal = grandSubtotal + grandShipping;

  const [form, setForm] = useState<AddressForm>({
    fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '',
  });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const placeOrders = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Devi essere autenticato per completare l\'ordine');
      if (groups.length === 0) throw new Error('Il carrello è vuoto');

      // Geocode indirizzo via Nominatim (fallback: lascia null)
      let deliveryLat: number | null = null;
      let deliveryLng: number | null = null;
      try {
        const q = encodeURIComponent(`${form.address}, ${form.zip} ${form.city}, Italia`);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=it`,
        );
        const json = await res.json();
        if (Array.isArray(json) && json[0]) {
          deliveryLat = parseFloat(json[0].lat);
          deliveryLng = parseFloat(json[0].lon);
        }
      } catch {
        // continua senza coord — la mappa sara' centrata sul negozio
      }

      const createdOrders: string[] = [];

      for (const g of groups) {
        const subtotal = groupSubtotal(g);
        const shipping = SHIPPING_COST_FOR(subtotal);
        const total = subtotal + shipping;

        const { data: order, error: orderError } = await supabase.from('orders').insert({
          user_id: user.id,
          seller_id: g.sellerId,
          total_price: total,
          shipping_cost: shipping,
          payment_status: 'PENDING',
          delivery_status: 'NEW',
          delivery_full_name: form.fullName,
          delivery_phone: form.phone,
          delivery_address: form.address,
          delivery_city: form.city,
          delivery_zip: form.zip,
          delivery_notes: form.notes || null,
          delivery_lat: deliveryLat,
          delivery_lng: deliveryLng,
        }).select().single();
        if (orderError) throw orderError;

        const items = g.items.map((item) => ({
          order_id: order.id,
          product_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
        }));
        const { error: itemsError } = await supabase.from('order_items').insert(items);
        if (itemsError) throw itemsError;

        // Notifica il seller
        notify({
          userId: g.sellerId,
          title: '🎉 Nuovo ordine!',
          body: `${form.fullName} ha effettuato un ordine da ${formatPrice(total)}`,
          link: `/seller/orders/${order.id}`,
        });

        createdOrders.push(order.id);
      }

      return createdOrders;
    },
    onSuccess: (orderIds) => {
      clearCart();
      if (orderIds.length === 1) {
        toast.success('Ordine effettuato! 🎉');
        router.push(`/orders/${orderIds[0]}`);
      } else {
        toast.success(`${orderIds.length} ordini effettuati! 🎉`);
        router.push('/orders');
      }
    },
    onError: (err: any) => toast.error(err.message || 'Errore durante il checkout'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.address.trim() || !form.city.trim() || !form.zip.trim() || !form.phone.trim()) {
      toast.error('Compila tutti i campi obbligatori');
      return;
    }
    placeOrders.mutate();
  };

  if (cart.length === 0) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4">
        <p className="text-gray-500 text-lg">Il tuo carrello è vuoto.</p>
        <Link href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg">
          Torna al negozio
        </Link>
      </div>
    );
  }

  if (loadingGroups) {
    return <div className="container mx-auto p-12 text-center text-gray-500">Caricamento...</div>;
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      <div className="flex items-center justify-center gap-4 sm:gap-8 mb-8 flex-wrap">
        <Step num={1} label="Carrello" done />
        <div className="w-8 sm:w-16 h-px bg-gray-300" />
        <Step num={2} label="Indirizzo" active />
        <div className="w-8 sm:w-16 h-px bg-gray-300" />
        <Step num={3} label="Conferma" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* INDIRIZZO */}
          <div className="bg-white border rounded-xl p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">📍 Indirizzo di consegna</h2>
            <form onSubmit={handleSubmit} className="space-y-4" id="checkout-form">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome e cognome</label>
                <input type="text" name="fullName" value={form.fullName} onChange={handleChange}
                  placeholder="Mario Rossi"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Indirizzo</label>
                <input type="text" name="address" value={form.address} onChange={handleChange}
                  placeholder="Via Roma 1"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Città</label>
                  <input type="text" name="city" value={form.city} onChange={handleChange}
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CAP</label>
                  <input type="text" name="zip" value={form.zip} onChange={handleChange}
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
                <input type="tel" name="phone" value={form.phone} onChange={handleChange}
                  placeholder="3331234567"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                <p className="text-xs text-gray-400 mt-1">Il rider ti chiamerà se serve per la consegna</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note per il rider <span className="text-gray-400 font-normal">(opzionale)</span>
                </label>
                <textarea name="notes" value={form.notes} onChange={handleChange}
                  rows={2}
                  placeholder="Es. citofono Rossi, suonare al 2° piano…"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
              </div>
            </form>
          </div>

          {/* PAGAMENTO */}
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4">💳 Metodo di pagamento</h2>
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex items-start gap-3">
              <input type="radio" checked readOnly className="mt-1" />
              <div>
                <p className="font-bold text-gray-900">Contanti alla consegna</p>
                <p className="text-sm text-gray-600">Paghi al rider quando ricevi il pacco.</p>
              </div>
            </div>
          </div>

          {/* RIEPILOGO PER NEGOZIO */}
          {groups.length > 1 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <strong>Il tuo carrello include prodotti da {groups.length} negozi diversi.</strong> Verranno creati {groups.length} ordini separati, uno per ciascun negozio. Ogni rider consegna il proprio ordine.
            </div>
          )}

          {orphans.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800 space-y-3">
              <p>
                <strong>⚠ {orphans.length} {orphans.length === 1 ? 'prodotto non è più disponibile' : 'prodotti non sono più disponibili'}</strong>: {orphans.map((o) => o.name).join(', ')}.
              </p>
              <button
                type="button"
                onClick={() => {
                  orphans.forEach((o) => removeFromCart(o.id));
                  setCart(getCart());
                  toast.success('Articoli non disponibili rimossi');
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-semibold text-sm"
              >
                Rimuovi dal carrello
              </button>
            </div>
          )}

          {groups.length === 0 && orphans.length === 0 && !loadingGroups && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800">
              <strong>⚠ Errore nel caricamento dei prodotti.</strong> Prova a ricaricare la pagina, oppure svuota il carrello e riprova.
            </div>
          )}
        </div>

        {/* RIEPILOGO ORDINE */}
        <div className="lg:sticky lg:top-32 h-fit space-y-4">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b px-5 py-3 flex justify-between items-center">
              <h2 className="font-bold">Riepilogo ordine</h2>
              <span className="text-xs text-gray-400">{cart.length} articoli</span>
            </div>

            <div className="divide-y max-h-72 overflow-y-auto">
              {groups.map((g) => (
                <div key={g.sellerId} className="px-5 py-3">
                  <p className="text-xs font-semibold text-indigo-700 mb-2">🏪 {g.storeName}</p>
                  {g.items.map((item) => (
                    <div key={item.id} className="flex gap-3 items-center pl-2 py-1">
                      <div className="relative w-10 h-10 bg-gray-100 rounded shrink-0 overflow-hidden">
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
              ))}
            </div>

            <div className="px-5 py-4 space-y-2 border-t bg-gray-50/50 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(grandSubtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Spedizione</span>
                <span className={`font-semibold ${grandShipping === 0 ? 'text-emerald-600' : ''}`}>
                  {grandShipping === 0 ? 'GRATUITA' : formatPrice(grandShipping)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t font-bold text-lg">
                <span>Totale</span>
                <span className="text-indigo-700">{formatPrice(grandTotal)}</span>
              </div>
            </div>

            <button
              type="submit"
              form="checkout-form"
              disabled={placeOrders.isPending}
              className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 py-4 font-extrabold text-base transition-colors shadow-lg"
            >
              {placeOrders.isPending ? 'Elaborazione...' : `✓ Conferma ordine · ${formatPrice(grandTotal)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
