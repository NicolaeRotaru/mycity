'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartItem, getCart, updateQuantity, removeFromCart, cartTotal, cartCount } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getCart());
    refresh();
    window.addEventListener('cart:updated', refresh);
    return () => window.removeEventListener('cart:updated', refresh);
  }, []);

  const total = cartTotal(items);
  const count = cartCount(items);
  const missing = Math.max(0, FREE_SHIPPING_THRESHOLD - total);
  const shippingProgress = Math.min(100, (total / FREE_SHIPPING_THRESHOLD) * 100);
  const freeShipping = total >= FREE_SHIPPING_THRESHOLD;
  const shippingCost = freeShipping ? 0 : 4.9;
  const finalTotal = total + shippingCost;

  if (items.length === 0) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4 max-w-md">
        <p className="text-7xl">🛒</p>
        <h1 className="text-2xl font-bold">Il tuo carrello è vuoto</h1>
        <p className="text-gray-500">Scopri i prodotti dei negozi locali della tua città</p>
        <Link
          href="/"
          className="inline-block bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-8 py-3 rounded-lg font-bold shadow-md"
        >
          Inizia ad acquistare
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8">
      {/* Step indicator (carrello attivo) */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <span className="font-bold text-indigo-700">1. Carrello</span>
        <span className="text-gray-300">›</span>
        <span className="text-gray-400">2. Indirizzo</span>
        <span className="text-gray-300">›</span>
        <span className="text-gray-400">3. Conferma</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNA SX: prodotti */}
        <div className="lg:col-span-2 space-y-4">
          <h1 className="text-2xl font-bold">
            Il tuo carrello <span className="text-gray-400 font-normal">({count} articoli)</span>
          </h1>

          {/* Progress free shipping */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            {freeShipping ? (
              <p className="text-emerald-700 font-semibold flex items-center gap-2">
                <span className="text-2xl">🎉</span> Hai sbloccato la <strong>spedizione gratuita</strong>!
              </p>
            ) : (
              <>
                <p className="text-emerald-800 font-medium mb-2">
                  Ti mancano solo <strong>{formatPrice(missing)}</strong> per la <strong>spedizione gratuita</strong> 🚚
                </p>
                <div className="w-full bg-emerald-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${shippingProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>

          {items.map((item) => (
            <div key={item.id} className="bg-white border rounded-xl p-4 flex gap-4 hover:shadow-md transition-shadow">
              <div className="relative w-24 h-24 bg-gray-100 rounded-lg shrink-0 overflow-hidden">
                <Image
                  src={item.image ?? 'https://placehold.co/200x200/eef2ff/6366f1?text=Foto'}
                  alt={item.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <Link
                  href={`/product/${item.id}`}
                  className="font-semibold hover:text-indigo-600 line-clamp-2"
                >
                  {item.name}
                </Link>
                <p className="text-xs text-emerald-600 font-semibold">✓ Disponibile · Spedizione 24-48h</p>
                <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-lg">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-8 h-8 hover:bg-gray-100 rounded-l-lg"
                      >−</button>
                      <span className="w-8 text-center font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-8 h-8 hover:bg-gray-100 rounded-r-lg"
                      >+</button>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-gray-400 hover:text-red-600 text-sm ml-2"
                    >
                      🗑️ Rimuovi
                    </button>
                  </div>
                  <span className="font-bold text-gray-900 text-lg">{formatPrice(item.price * item.quantity)}</span>
                </div>
              </div>
            </div>
          ))}

          <Link
            href="/"
            className="inline-block text-indigo-600 hover:underline font-semibold text-sm mt-2"
          >
            ← Continua lo shopping
          </Link>
        </div>

        {/* COLONNA DX: riepilogo sticky */}
        <div className="space-y-4 lg:sticky lg:top-32 h-fit">
          <div className="bg-white border rounded-xl p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-bold flex items-center justify-between">
              Riepilogo ordine
              <span className="text-xs font-normal text-gray-400">{count} articoli</span>
            </h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Spedizione</span>
                <span className={`font-semibold ${freeShipping ? 'text-emerald-600' : 'text-gray-900'}`}>
                  {freeShipping ? 'GRATUITA' : formatPrice(shippingCost)}
                </span>
              </div>
            </div>

            <div className="border-t pt-3 flex justify-between items-baseline">
              <span className="font-bold">Totale</span>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-indigo-700">{formatPrice(finalTotal)}</div>
                <div className="text-[10px] text-gray-400 uppercase">IVA inclusa</div>
              </div>
            </div>

            <Link
              href="/checkout"
              className="block w-full text-center bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3.5 rounded-lg font-bold shadow-md hover:shadow-lg transition-all"
            >
              🔒 Procedi al checkout
            </Link>

            <div className="space-y-2 pt-2 text-xs text-gray-500">
              <p className="flex items-center gap-2"><span>💳</span> Pagamento in contanti alla consegna</p>
              <p className="flex items-center gap-2"><span>🔒</span> I tuoi dati sono al sicuro</p>
              <p className="flex items-center gap-2"><span>↩️</span> Reso facile entro 14 giorni</p>
              <p className="flex items-center gap-2"><span>🏘️</span> Supporti il commercio locale</p>
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-indigo-900 mb-1">💡 Lo sapevi?</p>
            <p className="text-indigo-800">
              Acquistando qui sostieni direttamente i commercianti della tua città. Niente intermediari, niente commissioni nascoste.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
