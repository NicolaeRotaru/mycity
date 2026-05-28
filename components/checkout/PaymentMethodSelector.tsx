'use client';

/**
 * Selettore metodo di pagamento per checkout: card o COD.
 *
 * Multi-seller è supportato per entrambi i metodi:
 *  - CARD: una sola charge sulla piattaforma, N ordini creati dal webhook
 *    (Separate Charges and Transfers, vedi lib/stripe/client.ts).
 *  - COD: N ordini creati direttamente lato client.
 *
 * Estratto da app/checkout/page.tsx per ridurre il monolite.
 */

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
    <div className="bg-white border rounded-xl p-6">
      <h2 className="text-xl font-bold flex items-center gap-2 mb-4">💳 Metodo di pagamento</h2>
      <div className="space-y-3">
        {stripeAvailable && (
          <label
            className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors ${
              value === 'card'
                ? 'border-primary-400 bg-primary-50'
                : 'border-cream-300 bg-white hover:border-primary-200'
            }`}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="card"
              checked={value === 'card'}
              onChange={() => onChange('card')}
              className="mt-1"
            />
            <div className="flex-1">
              <p className="font-bold text-ink-900">💳 Carta di credito / debito</p>
              <p className="text-sm text-ink-600">
                Visa, Mastercard, Amex, Apple Pay, Google Pay — pagamento sicuro su Stripe.
              </p>
              {multiSeller && (
                <p className="text-xs text-primary-700 mt-1">
                  ℹ Un solo pagamento per tutto il carrello, anche con più negozi.
                </p>
              )}
            </div>
          </label>
        )}

        <label
          className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors ${
            value === 'cod'
              ? 'border-accent-400 bg-accent-50'
              : 'border-cream-300 bg-white hover:border-accent-200'
          }`}
        >
          <input
            type="radio"
            name="paymentMethod"
            value="cod"
            checked={value === 'cod'}
            onChange={() => onChange('cod')}
            className="mt-1"
          />
          <div className="flex-1">
            <p className="font-bold text-ink-900">💵 Contanti alla consegna</p>
            <p className="text-sm text-ink-600">Paghi al rider quando ricevi il pacco.</p>
          </div>
        </label>
      </div>
    </div>
  );
}
