'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartItem, getCart, updateQuantity, removeFromCart, cartTotal } from '@/lib/cart';
import { formatPrice } from '@/lib/format';

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getCart());
    refresh();
    window.addEventListener('cart:updated', refresh);
    return () => window.removeEventListener('cart:updated', refresh);
  }, []);

  const total = cartTotal(items);

  if (items.length === 0) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4">
        <p className="text-6xl">🛒</p>
        <h1 className="text-2xl font-bold">Il tuo carrello è vuoto</h1>
        <p className="text-gray-500">Aggiungi prodotti per iniziare lo shopping</p>
        <Link
          href="/"
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg"
        >
          Scopri i prodotti
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-4">
        <h1 className="text-2xl font-bold mb-4">Il tuo carrello ({items.length} articoli)</h1>
        {items.map((item) => (
          <div key={item.id} className="bg-white border rounded-lg p-4 flex gap-4">
            <div className="relative w-24 h-24 bg-gray-100 rounded shrink-0">
              <Image
                src={item.image ?? 'https://placehold.co/200x200/eee/aaa?text=Foto'}
                alt={item.name}
                fill
                className="object-cover rounded"
                unoptimized
              />
            </div>
            <div className="flex-1 flex flex-col justify-between">
              <Link href={`/product/${item.id}`} className="font-semibold hover:text-indigo-600">
                {item.name}
              </Link>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="w-7 h-7 border rounded hover:bg-gray-50"
                  >−</button>
                  <span className="w-8 text-center font-semibold">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="w-7 h-7 border rounded hover:bg-gray-50"
                  >+</button>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="text-red-500 hover:text-red-700 text-sm ml-3"
                  >
                    Rimuovi
                  </button>
                </div>
                <span className="font-bold text-indigo-700">{formatPrice(item.price * item.quantity)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-lg p-6 h-fit space-y-4 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold">Riepilogo</h2>
        <div className="flex justify-between text-sm">
          <span>Subtotale</span>
          <span>{formatPrice(total)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Spedizione</span>
          <span className="text-green-600 font-semibold">Gratuita</span>
        </div>
        <div className="border-t pt-3 flex justify-between font-bold text-lg">
          <span>Totale</span>
          <span className="text-indigo-700">{formatPrice(total)}</span>
        </div>
        <Link
          href="/checkout"
          className="block w-full text-center bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 rounded-lg font-bold transition-colors"
        >
          Procedi al checkout
        </Link>
        <p className="text-xs text-gray-500 text-center">💳 Pagamento in contanti alla consegna</p>
      </div>
    </div>
  );
}
