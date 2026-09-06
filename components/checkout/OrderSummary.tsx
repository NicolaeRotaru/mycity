'use client';

import { AlertTriangle, Banknote, Check, Lock, RotateCcw, Store } from 'lucide-react';
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
  /** Fee piattaforma €3/consegna per negozio (solo consegna a domicilio). */
  platformDeliveryFee?: number;
  pickupDiscount: number;
  couponDiscount: number;
  /** Credito MyCity applicato (gift card / punti convertiti), in euro. */
  creditApplied?: number;
  total: number;
  isCheckingOut: boolean;
  paymentMethod: 'cod' | 'card';
  /** Disabilita il submit (es. carrello vuoto o articoli senza disponibilità). */
  disabled?: boolean;
  /**
   * PERCHE' l'ordine non parte, in italiano, gia' pronto da leggere.
   *
   * Va insieme a `disabled`: chi spegne il pulsante deve dire il motivo. Se
   * arriva, qui sopra al pulsante compare il riquadro che lo spiega.
   */
  motivoBlocco?: string | null;
  couponSection?: React.ReactNode;
};

/**
 * Porta la persona sul primo riquadro che spiega perche' l'ordine non parte.
 *
 * 6/9/2026 — Sta qui, esportata, perche' i pulsanti che chiudono l'acquisto
 * sono DUE: questo (di fianco, sul computer) e la barra incollata in fondo
 * (sul telefono, l'unico che si vede davvero). Scritta due volte si sarebbe
 * separata al primo ritocco.
 *
 * I riquadri sono gia' nella pagina, sopra il pulsante, e portano
 * `role="alert"`: si scorre fino al primo e gli si mette il fuoco, cosi' anche
 * chi usa un lettore di schermo se lo sente leggere.
 */
export function vaiAlPrimoBlocco(): boolean {
  const primoBlocco = document.querySelector<HTMLElement>('[role="alert"]');
  // Nessun riquadro a schermo vuol dire pulsante muto: chi chiama lo deve
  // sapere, invece di credere di aver spiegato qualcosa.
  if (!primoBlocco) return false;
  primoBlocco.scrollIntoView({ block: 'center', behavior: 'smooth' });
  primoBlocco.setAttribute('tabindex', '-1');
  primoBlocco.focus();
  return true;
}

export function OrderSummary({
  subtotal,
  shipping,
  platformDeliveryFee = 0,
  pickupDiscount,
  couponDiscount,
  creditApplied = 0,
  total,
  isCheckingOut,
  paymentMethod,
  disabled = false,
  motivoBlocco = null,
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
        {platformDeliveryFee > 0 && (
          <div className="flex justify-between">
            <span className="text-ink-600">Consegna MyCity</span>
            <span className="font-semibold">{formatPrice(platformDeliveryFee)}</span>
          </div>
        )}
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

      {/* 6/9/2026 — UN PULSANTE SPENTO SENZA UNA RIGA CHE DICA PERCHE'.
          Il pulsante sbiadito rimandava al «primo riquadro con role=alert»
          che sta piu' su nella pagina. Ma i riquadri li avevano solo alcuni
          motivi di blocco: quando a fermare l'ordine era la fascia oraria non
          c'era nessun riquadro, e il pulsante si premeva senza che succedesse
          niente.
          Adesso il motivo arriva insieme al blocco (`motivoBlocco` vive con
          `disabled`) e si legge qui, attaccato al pulsante: qualunque sia la
          causa — anche una che ancora non esiste — chi non puo' pagare vede
          scritto perche'. `role="alert"` lo fa anche annunciare a chi non
          vede, e lo rende il bersaglio di `vaiAlPrimoBlocco`. */}
      {disabled && motivoBlocco && (
        <p
          role="alert"
          className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-900"
        >
          <AlertTriangle size={16} strokeWidth={2.2} className="shrink-0 mt-0.5" aria-hidden />
          <span><strong>Non puoi ancora ordinare.</strong> {motivoBlocco}</span>
        </p>
      )}

      {/* 22/8/2026 — IL PULSANTE SPARIVA DALLA TASTIERA.
          Quando c'era qualcosa da sistemare (merce finita, variante da
          scegliere) il pulsante veniva `disabled`, e un elemento disabilitato
          esce dal giro del tasto Tab: chi naviga da tastiera arrivava in fondo
          e non trovava piu' niente, senza sapere che c'era un motivo. Adesso
          resta raggiungibile e dichiara di essere bloccato con
          `aria-disabled`: si puo' arrivarci, si sente perche' non parte, e
          premendolo si va sul primo riquadro che spiega il blocco. */}
      <button
        type={disabled && !isCheckingOut ? 'button' : 'submit'}
        form="checkout-form"
        disabled={isCheckingOut}
        aria-disabled={disabled || isCheckingOut}
        onClick={
          disabled && !isCheckingOut
            ? (e) => {
                e.preventDefault();
                vaiAlPrimoBlocco();
              }
            : undefined
        }
        // 147 — L'`aria-label` sovrascriveva il testo visibile, che contiene
        // l'importo: chi usa un lettore di schermo sentiva «Conferma ordine» e
        // premeva senza sapere quanto stava pagando. Il testo visibile è già il
        // nome migliore.
        className="w-full bg-primary-700 hover:bg-primary-800 text-white disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed py-4 font-extrabold text-base transition-colors shadow-warm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-inset"
      >
        {isCheckingOut ? (
          paymentMethod === 'card' ? 'Apertura pagamento sicuro…' : 'Elaborazione…'
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            {paymentMethod === 'card'
              ? <Lock size={18} strokeWidth={2.4} aria-hidden />
              : <Check size={18} strokeWidth={2.4} aria-hidden />}
            {/* 22/8/2026 — «Conferma ordine» non dice che stai prendendo un
                impegno a pagare. Sul ramo contanti il pagamento avviene dopo,
                alla consegna, ed è proprio per questo che il pulsante lo deve
                dire: chi preme deve sapere che al fattorino dovrà dare dei
                soldi. Il Codice del Consumo chiede che il pulsante finale
                riporti una formula inequivocabile. */}
            {paymentMethod === 'card'
              ? `Paga con carta · ${formatPrice(total)}`
              : `Ordina e paga alla consegna · ${formatPrice(total)}`}
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
