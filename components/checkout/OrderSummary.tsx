'use client';

import { Banknote, Check, Lock, RotateCcw, Store } from 'lucide-react';
import { formatPrice } from '@/lib/format';

/**
 * Riepilogo costi + bottone submit del checkout.
 *
 * RESKIN: totale in serif, CTA primary, micro-rassicurazioni invariate.
 * Controlled component — riceve tutti i totali e callbacks dal parent.
 * LOGICA INVARIATA: stesso submit `form="checkout-form"`, stessi totali,
 * stesso `disabled`/`isCheckingOut`, ramo card vs cod.
 */

type Props = {
  subtotal: number;
  shipping: number;
  pickupDiscount: number;
  couponDiscount: number;
  /** Credito MyCity applicato (gift card / punti convertiti), in euro. */
  creditApplied?: number;
  total: number;
  isCheckingOut: boolean;
  paymentMethod: 'cod' | 'card';
  /** Disabilita il submit (es. carrello vuoto o articoli senza disponibilità). */
  disabled?: boolean;
  couponSection?: React.ReactNode;
};

export function OrderSummary({
  subtotal,
  shipping,
  pickupDiscount,
  couponDiscount,
  creditApplied = 0,
  total,
  isCheckingOut,
  paymentMethod,
  disabled = false,
  couponSection,
}: Props) {
  return (
    <>
      {couponSection}

      <div className="px-5 py-4 space-y-2 border-t border-cream-300 bg-cream-50/50 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-600">Subtotale</span>
          <span className="font-semibold">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-600">Spedizione</span>
          <span className={`font-semibold ${shipping === 0 ? 'text-olive-600' : ''}`}>
            {shipping === 0 ? 'Gratis' : formatPrice(shipping)}
          </span>
        </div>
        {pickupDiscount > 0 && (
          <div className="flex justify-between text-olive-700">
            <span>Sconto ritiro in negozio</span>
            <span className="font-semibold">−{formatPrice(pickupDiscount)}</span>
          </div>
        )}
        {couponDiscount > 0 && (
          <div className="flex justify-between text-olive-700">
            <span>Sconto codice</span>
            <span className="font-semibold">−{formatPrice(couponDiscount)}</span>
          </div>
        )}
        {creditApplied > 0 && (
          <div className="flex justify-between text-olive-700">
            <span>Credito MyCity</span>
            <span className="font-semibold">−{formatPrice(creditApplied)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline pt-2 border-t border-cream-300">
          <span className="font-bold">Totale</span>
          <span className="font-serif text-xl font-extrabold text-primary-800">{formatPrice(total)}</span>
        </div>
      </div>

      <button
        type="submit"
        form="checkout-form"
        disabled={isCheckingOut || disabled}
        aria-label={paymentMethod === 'card' ? 'Paga con carta e conferma ordine' : 'Conferma ordine'}
        className="w-full bg-primary-700 hover:bg-primary-800 text-white disabled:opacity-50 disabled:cursor-not-allowed py-4 font-extrabold text-base transition-colors shadow-warm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-inset"
      >
        {isCheckingOut ? (
          paymentMethod === 'card' ? 'Apertura pagamento sicuro…' : 'Elaborazione…'
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            {paymentMethod === 'card'
              ? <Lock size={18} strokeWidth={2.4} aria-hidden />
              : <Check size={18} strokeWidth={2.4} aria-hidden />}
            {paymentMethod === 'card'
              ? `Paga con carta · ${formatPrice(total)}`
              : `Conferma ordine · ${formatPrice(total)}`}
          </span>
        )}
      </button>

      {/* Rassicurazione al momento del pagamento — leva anti-abbandono */}
      <div className="px-5 py-4 space-y-3 border-t border-surface-200">
        <p className="flex items-start gap-2 text-sm text-olive-800">
          {paymentMethod === 'card' ? (
            <>
              <Lock size={16} strokeWidth={2.2} className="text-olive-600 shrink-0 mt-0.5" aria-hidden />
              <span><strong>Pagamento sicuro con Stripe.</strong> Niente costi nascosti.</span>
            </>
          ) : (
            <>
              <Banknote size={16} strokeWidth={2.2} className="text-olive-600 shrink-0 mt-0.5" aria-hidden />
              <span><strong>Non paghi adesso.</strong> Paghi in contanti al rider quando arriva.</span>
            </>
          )}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
          <li className="inline-flex items-center gap-1">
            <RotateCcw size={13} strokeWidth={2.2} aria-hidden /> Reso entro 14 giorni
          </li>
          <li className="inline-flex items-center gap-1">
            <Store size={13} strokeWidth={2.2} aria-hidden /> Venditore locale
          </li>
        </ul>
      </div>
    </>
  );
}
