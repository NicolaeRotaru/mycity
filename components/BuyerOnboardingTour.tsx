'use client';

import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { useRef, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { X, MapPin, ShoppingCart, Gift, ArrowRight } from 'lucide-react';
import { frasePagamento } from '@/lib/promesse-pubbliche';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { useProfile } from './hooks/useProfile';
import { useLocalStorage } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';

/**
 * Onboarding tour buyer al primo login.
 *
 * Esperti consultati:
 * - UX Researcher: "Walkthrough 3 step max. Sopra perdi 60% degli utenti."
 * - Behavioral Scientist: "Reinforce value proposition + mostra primo passo
 *   concreto. Coupon visibile → +25% activation."
 * - Content Designer: "Voce calda, italiano vivo. 'Compra dai veri' > 'shop now'."
 *
 * Trigger: 1° visita post-signup. Dismissible. Mai mostrato 2 volte.
 */

const KEY = 'mc_buyer_onboarded';

const STEPS = [
  {
    icon: Gift,
    title: 'Benvenuto su MyCity',
    body: 'Hai €5 di benvenuto pronti per il tuo primo ordine. Si applicano in automatico al checkout.',
    cta: 'Vai avanti',
  },
  {
    icon: MapPin,
    title: 'Scegli un negozio della tua città',
    body: 'Tutti i prodotti vengono da commercianti veri di Piacenza. Niente catene, niente magazzini lontani.',
    cta: 'Continua',
  },
  {
    icon: ShoppingCart,
    title: 'Ordina, paghi come vuoi',
    // «carta o contanti alla consegna» era falso sulla meta' carta: al checkout la carta si paga
    // subito. La frase e i minuti vengono da dove sono decisi.
    body: `Aggiungi al carrello e al checkout scegli come pagare. ${frasePagamento()}. Consegna in ${EXPRESS_ETA_LABEL}.`,
    cta: 'Inizia a esplorare',
    href: '/search',
  },
];

export default function BuyerOnboardingTour() {
  const pathname = usePathname();
  const { isAuthenticated, isBuyer } = useProfile();
  const [onboarded, setOnboarded] = useLocalStorage<boolean>(KEY, false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  /**
   * 21/8/2026 — IL TOUR SI APRIVA SOPRA IL PAGAMENTO, E IL SUO ULTIMO PULSANTE
   * PORTAVA VIA DALL'ORDINE.
   *
   * Il tour parte per chi si e' appena registrato, un secondo e mezzo dopo che
   * la pagina si apre, e nessuna pagina era esclusa. Ma il sito chiede l'account
   * proprio all'ultimo clic del checkout: quindi quasi tutti si registrano
   * mentre stanno comprando, e tornavano sul pagamento giusto in tempo per
   * vederselo comparire davanti. L'ultimo passo del tour manda alla ricerca.
   *
   * Un tour di benvenuto e' una cosa che si guarda quando si ha tempo. Chi sta
   * pagando non ce l'ha, e interromperlo li' costa un ordine.
   */
  const dentroUnAcquisto =
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/cart') ||
    pathname.startsWith('/orders/');

  useEffect(() => {
    if (!isAuthenticated || !isBuyer || onboarded) return;
    if (dentroUnAcquisto) return;
    // Defer 1.5s per non sovrapporsi a banner welcome
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [isAuthenticated, isBuyer, onboarded, dentroUnAcquisto]);

  const close = () => {
    setOnboarded(true);
    setOpen(false);
  };

  // Fuoco dentro il riquadro, uscita con Esc, ritorno dov'era: le tre cose che
  // rendono un pannello un pannello anche senza mouse.
  const pannelloRef = useRef<HTMLDivElement>(null);
  /**
   * 27/8/2026 (R112) — QUI IL RIFERIMENTO ERA SEMPRE VUOTO.
   *
   * `useBottomSheetA11y` alla chiusura fa `trigger?.focus()`, ma gli veniva
   * passato un `useRef` creato e mai attaccato a nessun elemento: la chiamata
   * non faceva niente e il fuoco cadeva sul corpo della pagina. Chi naviga da
   * tastiera chiudeva il pannello e si ritrovava all'inizio del sito.
   *
   * Invece di far viaggiare un riferimento da chi apre a chi si apre, il
   * pannello si ricorda da solo DOVE stava il fuoco un attimo prima di aprirsi:
   * funziona da qualunque punto lo si apra, anche da un pulsante che non è
   * quello previsto.
   */
  const avvioRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) avvioRef.current = document.activeElement as HTMLButtonElement | null;
  }, [open]);
  useBottomSheetA11y(open, pannelloRef, avvioRef, close);

  const next = () => {
    if (step >= STEPS.length - 1) close();
    else setStep(step + 1);
  };

  if (!open) return null;
  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      {/* 22/8/2026 — QUESTO PANNELLO COPRIVA LO SCHERMO SENZA DIRE DI ESSERLO.
          Si apre da solo al primo accesso e prende tutta la pagina, ma per uno
          screen reader era un pezzo di pagina qualunque: nessun annuncio, e da
          tastiera nessuna via d'uscita — Esc non faceva niente e il fuoco
          restava fuori dal riquadro, sopra una pagina coperta da un velo. E' la
          prima cosa che vede chi entra: restarci chiusi dentro e' la prima
          impressione peggiore che si possa dare. */}
      <div
        ref={pannelloRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titolo-tour"
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-warm-lg overflow-hidden animate-slide-up"
      >
        <div className="absolute top-3 right-3">
          <button onClick={close} aria-label="Chiudi tour" className="text-ink-400 hover:text-ink-700 p-1.5 rounded-full hover:bg-cream-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
            <Icon size={28} strokeWidth={2.2} />
          </div>
          <h2 id="titolo-tour" className="font-serif text-2xl font-bold text-ink-900">{s.title}</h2>
          <p className="text-ink-600 leading-relaxed">{s.body}</p>

          {/* I pallini dicono a che punto si e', ma solo a chi li vede: questa
              riga dice la stessa cosa a chi ascolta. */}
          <p className="sr-only" role="status" aria-live="polite">
            Passo {step + 1} di {STEPS.length}: {s.title}
          </p>

          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 pt-2" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'bg-primary-700 w-6' : 'bg-cream-300 w-1.5'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-cream-200 p-4 flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="px-4 py-3 rounded-lg text-ink-600 hover:bg-cream-100 font-semibold text-sm">
              Indietro
            </button>
          )}
          {isLast && s.href ? (
            <Link
              href={s.href}
              onClick={close}
              className="flex-1 bg-primary-700 hover:bg-primary-800 text-white px-4 py-3 rounded-lg font-bold inline-flex items-center justify-center gap-1.5"
            >
              {s.cta} <ArrowRight size={16} strokeWidth={2.4} />
            </Link>
          ) : (
            <Button
              onClick={next}
              fullWidth
              iconRight={ArrowRight}
            >
              {s.cta}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
