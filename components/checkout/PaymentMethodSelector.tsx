'use client';

/**
 * Selettore metodo di pagamento per checkout: card o COD.
 *
 * Multi-seller è supportato per entrambi i metodi:
 *  - CARD: una sola charge sulla piattaforma, N ordini creati dal webhook
 *    (Separate Charges and Transfers, vedi lib/stripe/client.ts).
 *  - COD: N ordini creati direttamente lato client.
 *
 * RESKIN: tile con quadrato-icona colorato + badge, al posto delle righe radio
 * piatte. La LOGICA è invariata — stessi radio `name="paymentMethod"`,
 * `value`/`onChange`, gating `stripeAvailable`, nota `multiSeller`.
 */

import { Badge } from '@/components/ui/Badge';
import { Banknote, CreditCard, Info } from 'lucide-react';

type PaymentMethod = 'cod' | 'card';

type Props = {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  stripeAvailable: boolean;
  /** Informativo: mostra al buyer che con card sarà 1 charge / N ordini. */
  multiSeller: boolean;
};

export function PaymentMethodSelector({ value, onChange, stripeAvailable, multiSeller }: Props) {
  return (
    <div className="space-y-3">
      {stripeAvailable && (
        <label
          className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${
            value === 'card'
              ? 'border-primary-500 bg-primary-50'
              : 'border-cream-300 bg-white hover:border-primary-200'
          }`}
        >
          <input
            type="radio"
            name="paymentMethod"
            value="card"
            checked={value === 'card'}
            onChange={() => onChange('card')}
            className="mt-2.5 accent-primary-600"
          />
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
            <CreditCard size={20} aria-hidden />
          </span>
          <div className="flex-1">
            <p className="font-bold text-ink-900">Carta di credito / debito</p>
            <p className="text-sm text-ink-600">
              Visa, Mastercard, Amex, Apple Pay, Google Pay — pagamento sicuro su Stripe.
            </p>
            {multiSeller && (
              <p className="text-xs text-primary-700 mt-1 flex items-center gap-1">
                <Info size={13} aria-hidden /> Un solo pagamento per tutto il carrello, anche con più negozi.
              </p>
            )}
          </div>
        </label>
      )}

      <label
        className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${
          value === 'cod'
            ? 'border-olive-400 bg-olive-50'
            : 'border-cream-300 bg-white hover:border-olive-200'
        }`}
      >
        <input
          type="radio"
          name="paymentMethod"
          value="cod"
          checked={value === 'cod'}
          onChange={() => onChange('cod')}
          className="mt-2.5 accent-olive-600"
        />
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-olive-100 text-olive-700">
          <Banknote size={20} aria-hidden />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-ink-900">Contanti alla consegna</p>
            <Badge variant="cod">Zero rischio</Badge>
          </div>
          <p className="text-sm text-ink-600">Paghi al rider quando ricevi il pacco.</p>
        </div>
      </label>
    </div>
  );
}
