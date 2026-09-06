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
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { Banknote, CreditCard, Info, Store } from 'lucide-react';

type PaymentMethod = 'cod' | 'card';

/* ═══════════════════════════════════════════════════════════════════════════
 * L'INTENZIONE DICHIARATA SULLA SCHEDA PRODOTTO ARRIVA FINO ALLA CASSA.
 *
 * 6/9/2026 — «COMPRA ORA · PAGHI ALLA CONSEGNA» APRIVA LA CASSA CON LA CARTA.
 *
 * Sulla scheda prodotto c'e' un pulsante che promette una cosa precisa nel suo
 * testo: paghi alla consegna. Chi lo preme lo preme apposta, spesso proprio
 * per non mettere la carta. In cassa pero' il metodo partiva sempre da
 * «carta», perche' e' il valore di partenza quando il pagamento online e'
 * acceso. La promessa del pulsante e la casella accesa dicevano due cose
 * diverse, e chi non se ne accorgeva pagava online senza volerlo.
 *
 * L'intenzione viaggia nella memoria della scheda del browser
 * (`sessionStorage`): si scrive quando si preme il pulsante, si legge una
 * volta sola in cassa e si cancella subito. Non e' una preferenza salvata:
 * dura il tempo di quel viaggio. Chi arriva in cassa dal carrello, o
 * ricaricando la pagina, ritrova il valore di partenza di sempre.
 * ═══════════════════════════════════════════════════════════════════════════ */

const MEMORIA_METODO_SCELTO = 'mc_metodo_scelto';

/** Scrive l'intenzione prima di mandare la persona in cassa. */
export function ricordaMetodoScelto(metodo: PaymentMethod) {
  try {
    window.sessionStorage.setItem(MEMORIA_METODO_SCELTO, metodo);
  } catch {
    // Navigazione privata o memoria piena: si perde l'intenzione, non l'ordine.
  }
}

/** Legge l'intenzione UNA volta e la cancella: vale per quel viaggio soltanto. */
export function raccogliMetodoScelto(): PaymentMethod | null {
  try {
    const scelto = window.sessionStorage.getItem(MEMORIA_METODO_SCELTO);
    window.sessionStorage.removeItem(MEMORIA_METODO_SCELTO);
    return scelto === 'cod' || scelto === 'card' ? scelto : null;
  } catch {
    return null;
  }
}

type Props = {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  stripeAvailable: boolean;
  /** Informativo: mostra al buyer che con card sarà 1 charge / N ordini. */
  multiSeller: boolean;
  /** Ritiro in negozio: stato + handler (la matematica dello sconto resta nel parent). */
  pickupInStore: boolean;
  onPickupChange: (next: boolean) => void;
  /** Sconto ritiro in euro (>0 quando pickupInStore è attivo). */
  pickupDiscount: number;
  /** Percentuale sconto ritiro, per il badge quando non ancora attivo. */
  pickupDiscountPercent: number;
};

export function PaymentMethodSelector({
  value,
  onChange,
  stripeAvailable,
  multiSeller,
  pickupInStore,
  onPickupChange,
  pickupDiscount,
  pickupDiscountPercent,
}: Props) {
  return (
    /**
     * 22/8/2026 — LE SCELTE DI PAGAMENTO NON ERANO UN GRUPPO.
     *
     * Erano due pulsanti radio sciolti dentro un contenitore qualsiasi. Chi
     * naviga con un lettore di schermo sente «carta, pulsante di scelta» e
     * «contanti, pulsante di scelta» senza che nessuno gli dica che sono
     * alternative della stessa domanda, né quante sono. Il `fieldset` con la
     * sua `legend` è il modo standard di dirlo, ed è già usato dieci righe più
     * in là per le fasce di consegna.
     */
    <fieldset className="space-y-3">
      <legend className="sr-only">Come vuoi pagare</legend>
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

      {/*
        RITIRO IN NEGOZIO — MESSO DA PARTE.
        Nicola, 20/8/2026: «togli il 10% di sconto per ritira in negozio, o
        mettilo da parte per il momento, perche non ne ho ancora parlato con i
        negozi di questo». Uno sconto sul prezzo di un negozio non si offre
        prima di averglielo chiesto.
        C'era anche un secondo motivo per spegnerlo tutto e non solo lo sconto:
        un ordine ritirato in negozio non arrivava MAI a «consegnato», perché
        l'unico modo di chiudere un ordine è il bottone del fattorino — e su un
        ritiro il fattorino non c'è. Il negoziante consegnava a mano e restava
        senza incasso, per sempre.
        Si riaccende con RITIRO_IN_NEGOZIO_ATTIVO in lib/constants.
      */}
      {RITIRO_IN_NEGOZIO_ATTIVO && (
      <label
        className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${
          pickupInStore ? 'border-olive-400 bg-olive-50' : 'border-cream-300 bg-white hover:border-olive-200'
        }`}
      >
        <input
          type="checkbox"
          checked={pickupInStore}
          onChange={(e) => onPickupChange(e.target.checked)}
          className="mt-2.5 w-4 h-4 accent-olive-600"
        />
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-olive-100 text-olive-700">
          <Store size={20} aria-hidden />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-ink-900">Ritira tu in negozio — salta la fila</p>
            {pickupInStore && pickupDiscount > 0 ? (
              <span className="bg-olive-600 text-white text-xs font-bold px-2 py-1 rounded shrink-0">
                −{formatPrice(pickupDiscount)}
              </span>
            ) : (
              <Badge variant="new">Sconto {pickupDiscountPercent}%</Badge>
            )}
          </div>
          <p className="text-sm text-ink-600">
            Niente spedizione, sconto subito. Vai tu al negozio quando l&apos;ordine è pronto.
          </p>
        </div>
      </label>
      )}
    </fieldset>
  );
}
