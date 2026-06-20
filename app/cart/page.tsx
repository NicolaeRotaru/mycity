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
import { FreeShippingProgress } from '@/components/ui/FreeShippingProgress';
import { StepIndicator, CHECKOUT_STEPS } from '@/components/checkout/StepIndicator';
import { Banknote, Check, Lightbulb, Lock, RotateCcw, ShieldCheck, ShoppingCart, Store, Trash2 } from 'lucide-react';
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
      toast('Pagamento annullato. Il carrello è ancora qui quando vuoi.');
      window.history.replaceState({}, '', '/cart');
    }
  }, []);

  const total = cartTotal(items);
  const count = cartCount(items);
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
      {/* Step indicator condiviso col checkout (carrello = step 1) */}
      <StepIndicator steps={CHECKOUT_STEPS} currentStep={1} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNA SX: prodotti */}
        <div className="lg:col-span-2 space-y-4">
          <h1 className="text-2xl font-bold">
            Il tuo carrello <span className="text-ink-400 font-normal">({count} articoli)</span>
          </h1>

          {/* Progress spedizione gratis (componente condiviso PDP/carrello/checkout) */}
          <FreeShippingProgress subtotal={total} />

          {items.map((item) => (
            <div key={`${item.id}::${item.variantId ?? ''}`} className="bg-white border rounded-xl p-4 flex gap-4 hover:shadow-md transition-shadow">
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
                {item.variantLabel && (
                  <p className="text-xs font-semibold text-ink-500">{item.variantLabel}</p>
                )}
                <p className="text-xs text-olive-600 font-semibold flex items-center gap-1">
                  <Check size={13} strokeWidth={2.5} aria-hidden /> Disponibile · Spedizione 24-48h
                </p>
                <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-lg">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantId)}
                        aria-label="Diminuisci quantità"
                        className="w-8 h-8 hover:bg-cream-100 rounded-l-lg"
                      >−</button>
                      <span className="w-8 text-center font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantId)}
                        aria-label="Aumenta quantità"
                        className="w-8 h-8 hover:bg-cream-100 rounded-r-lg"
                      >+</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.id, item.variantId)}
                      className="text-ink-400 hover:text-red-600 text-sm ml-2 flex items-center gap-1"
                    >
                      <Trash2 size={15} aria-hidden /> Rimuovi
                    </button>
                  </div>
                  <span className="font-bold font-serif text-ink-900 text-lg">{formatPrice(item.price * item.quantity)}</span>
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
                <div className="text-2xl font-extrabold font-serif text-primary-800">{formatPrice(finalTotal)}</div>
                <div className="text-[10px] text-ink-400 uppercase">IVA inclusa</div>
              </div>
            </div>

            <Link
              href="/checkout"
              className="flex items-center justify-center gap-2 w-full text-center bg-accent-500 hover:bg-accent-600 text-ink-900 py-3.5 rounded-lg font-bold shadow-warm hover:shadow-warm-lg transition-all"
            >
              <Lock size={16} strokeWidth={2.4} aria-hidden /> Procedi al checkout
            </Link>

            {/* Lista spesa condivisibile — Growth PM: viral coefficient,
                Behavioral Scientist: social proof + commitment partner */}
            <div className="text-center pt-1">
              <ShareCartButton items={items} />
            </div>

            <div className="space-y-2 pt-2 text-xs text-ink-500">
              <p className="flex items-center gap-2"><Banknote size={14} className="text-olive-600 shrink-0" aria-hidden /> Pagamento in contanti alla consegna</p>
              <p className="flex items-center gap-2"><ShieldCheck size={14} className="text-olive-600 shrink-0" aria-hidden /> I tuoi dati sono al sicuro</p>
              <p className="flex items-center gap-2"><RotateCcw size={14} className="text-olive-600 shrink-0" aria-hidden /> Reso facile entro 14 giorni</p>
              <p className="flex items-center gap-2"><Store size={14} className="text-olive-600 shrink-0" aria-hidden /> Supporti il commercio locale</p>
            </div>
          </div>

          <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-primary-900 mb-1 flex items-center gap-2">
              <Lightbulb size={16} className="text-primary-700 shrink-0" aria-hidden /> Lo sapevi?
            </p>
            <p className="text-primary-800">
              Acquistando qui sostieni direttamente i commercianti della tua città. Niente intermediari, niente commissioni nascoste.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
