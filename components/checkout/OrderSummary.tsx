'use client';

import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/Button';

/**
 * Riepilogo costi + bottone submit del checkout.
 *
 * Estratto da app/checkout/page.tsx. Controlled component — riceve tutti
 * i totali e callbacks dal parent.
 */

type Props = {
  subtotal: number;
  shipping: number;
  pickupDiscount: number;
  couponDiscount: number;
  total: number;
  isCheckingOut: boolean;
  paymentMethod: 'cod' | 'card';
  couponSection?: React.ReactNode;
};

export function OrderSummary({
  subtotal,
  shipping,
  pickupDiscount,
  couponDiscount,
  total,
  isCheckingOut,
  paymentMethod,
  couponSection,
}: Props) {
  return (
    <>
      {couponSection}

      <div className="px-5 py-4 space-y-2 border-t bg-cream-50/50 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-600">Subtotale</span>
          <span className="font-semibold">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-600">Spedizione</span>
          <span className={`font-semibold ${shipping === 0 ? 'text-olive-600' : ''}`}>
            {shipping === 0 ? 'GRATUITA' : formatPrice(shipping)}
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
        <div className="flex justify-between pt-2 border-t font-bold text-lg">
          <span>Totale</span>
          <span className="text-primary-800">{formatPrice(total)}</span>
        </div>
      </div>

      <button
        type="submit"
        form="checkout-form"
        disabled={isCheckingOut}
        className={`w-full disabled:opacity-50 py-4 font-extrabold text-base transition-colors shadow-lg ${
          paymentMethod === 'card'
            ? 'bg-primary-700 hover:bg-primary-800 text-white'
            : 'bg-accent-400 hover:bg-accent-500 text-ink-900'
        }`}
      >
        {isCheckingOut
          ? (paymentMethod === 'card' ? 'Apertura pagamento sicuro…' : 'Elaborazione…')
          : (paymentMethod === 'card'
              ? `🔒 Paga con carta · ${formatPrice(total)}`
              : `✓ Conferma ordine · ${formatPrice(total)}`)}
      </button>
    </>
  );
}
