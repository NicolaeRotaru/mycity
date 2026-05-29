'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartItem, getCart, updateQuantity, removeFromCart, cartTotal, cartCount } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import ShareCartButton from '@/components/ShareCartButton';
import EmptyState from '@/components/EmptyState';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getCart());
    refresh();
    window.addEventListener('cart:updated', refresh);
    return () => window.removeEventListener('cart:updated', refresh);
  }, []);

  // Feedback al rientro da Stripe Checkout annullato (?stripe=canceled)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'canceled') {
      toast('Pagamento annullato. Il carrello è ancora qui quando vuoi.', { icon: '🛒' });
      window.history.replaceState({}, '', '/cart');
    }
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
      <div className="container mx-auto py-12 max-w-2xl">
        <EmptyState
          icon={ShoppingCart}
          title="Il tuo carrello è vuoto"
          description="Scopri i prodotti dei negozi della tua città. Spedizione gratis sopra €30."
          ctaLabel="Esplora i prodotti"
          ctaHref="/search"
          secondaryLabel="Vedi i negozi"
          secondaryHref="/stores"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8">
      {/* Step indicator (carrello attivo) */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <span className="font-bold text-primary-800">1. Carrello</span>
        <span className="text-ink-300">›</span>
        <span className="text-ink-400">2. Indirizzo</span>
        <span className="text-ink-300">›</span>
        <span className="text-ink-400">3. Conferma</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNA SX: prodotti */}
        <div className="lg:col-span-2 space-y-4">
          <h1 className="text-2xl font-bold">
            Il tuo carrello <span className="text-ink-400 font-normal">({count} articoli)</span>
          </h1>

          {/* Progress free shipping */}
          <div className="bg-olive-50 border border-olive-200 rounded-xl p-4">
            {freeShipping ? (
              <p className="text-olive-700 font-semibold flex items-center gap-2">
                <span className="text-2xl">🎉</span> Hai sbloccato la <strong>spedizione gratuita</strong>!
              </p>
            ) : (
              <>
                <p className="text-olive-800 font-medium mb-2">
                  Ti mancano solo <strong>{formatPrice(missing)}</strong> per la <strong>spedizione gratuita</strong> 🚚
                </p>
                <div className="w-full bg-olive-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-olive-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${shippingProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>

          {items.map((item) => (
            <div key={item.id} className="bg-white border rounded-xl p-4 flex gap-4 hover:shadow-md transition-shadow">
              <div className="relative w-24 h-24 bg-cream-100 rounded-lg shrink-0 overflow-hidden">
                <Image
                  src={sizedImage(item.image ?? 'https://placehold.co/200x200/eef2ff/6366f1?text=Foto', 'thumb')}
                  alt={item.name}
                  fill
                  sizes="96px"
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="flex-1 flex flex-col justify-between min-w-0">
                <Link
                  href={`/product/${item.id}`}
                  className="font-semibold hover:text-primary-700 line-clamp-2"
                >
                  {item.name}
                </Link>
                <p className="text-xs text-olive-600 font-semibold">✓ Disponibile · Spedizione 24-48h</p>
                <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-lg">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        aria-label="Diminuisci quantità"
                        className="w-8 h-8 hover:bg-cream-100 rounded-l-lg"
                      >−</button>
                      <span className="w-8 text-center font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        aria-label="Aumenta quantità"
                        className="w-8 h-8 hover:bg-cream-100 rounded-r-lg"
                      >+</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.id)}
                      className="text-ink-400 hover:text-red-600 text-sm ml-2"
                    >
                      🗑️ Rimuovi
                    </button>
                  </div>
                  <span className="font-bold text-ink-900 text-lg">{formatPrice(item.price * item.quantity)}</span>
                </div>
              </div>
            </div>
          ))}

          <Link
            href="/"
            className="inline-block text-primary-700 hover:underline font-semibold text-sm mt-2"
          >
            ← Continua lo shopping
          </Link>
        </div>

        {/* COLONNA DX: riepilogo sticky */}
        <div className="space-y-4 lg:sticky lg:top-32 h-fit">
          <div className="bg-white border rounded-xl p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-bold flex items-center justify-between">
              Riepilogo ordine
              <span className="text-xs font-normal text-ink-400">{count} articoli</span>
            </h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-600">Spedizione</span>
                <span className={`font-semibold ${freeShipping ? 'text-olive-600' : 'text-ink-900'}`}>
                  {freeShipping ? 'GRATUITA' : formatPrice(shippingCost)}
                </span>
              </div>
            </div>

            <div className="border-t pt-3 flex justify-between items-baseline">
              <span className="font-bold">Totale</span>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-primary-800">{formatPrice(finalTotal)}</div>
                <div className="text-[10px] text-ink-400 uppercase">IVA inclusa</div>
              </div>
            </div>

            <Link
              href="/checkout"
              className="block w-full text-center bg-accent-500 hover:bg-accent-600 text-ink-900 py-3.5 rounded-lg font-bold shadow-warm hover:shadow-warm-lg transition-all"
            >
              🔒 Procedi al checkout
            </Link>

            {/* Lista spesa condivisibile — Growth PM: viral coefficient,
                Behavioral Scientist: social proof + commitment partner */}
            <div className="text-center pt-1">
              <ShareCartButton items={items} />
            </div>

            <div className="space-y-2 pt-2 text-xs text-ink-500">
              <p className="flex items-center gap-2"><span>💳</span> Pagamento in contanti alla consegna</p>
              <p className="flex items-center gap-2"><span>🔒</span> I tuoi dati sono al sicuro</p>
              <p className="flex items-center gap-2"><span>↩️</span> Reso facile entro 14 giorni</p>
              <p className="flex items-center gap-2"><span>🏘️</span> Supporti il commercio locale</p>
            </div>
          </div>

          <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-primary-900 mb-1">💡 Lo sapevi?</p>
            <p className="text-primary-800">
              Acquistando qui sostieni direttamente i commercianti della tua città. Niente intermediari, niente commissioni nascoste.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
