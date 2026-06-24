'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, MapPin, ShoppingCart, Gift, ArrowRight } from 'lucide-react';
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
    body: 'Aggiungi al carrello e al checkout scegli come pagare: carta o contanti alla consegna, decidi tu. Consegna in 24-48h.',
    cta: 'Inizia a esplorare',
    href: '/search',
  },
];

export default function BuyerOnboardingTour() {
  const { isAuthenticated, isBuyer } = useProfile();
  const [onboarded, setOnboarded] = useLocalStorage<boolean>(KEY, false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !isBuyer || onboarded) return;
    // Defer 1.5s per non sovrapporsi a banner welcome
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [isAuthenticated, isBuyer, onboarded]);

  const close = () => {
    setOnboarded(true);
    setOpen(false);
  };

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
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-warm-lg overflow-hidden animate-slide-up">
        <div className="absolute top-3 right-3">
          <button onClick={close} aria-label="Chiudi tour" className="text-ink-400 hover:text-ink-700 p-1.5 rounded-full hover:bg-cream-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
            <Icon size={28} strokeWidth={2.2} />
          </div>
          <h2 className="font-serif text-2xl font-bold text-ink-900">{s.title}</h2>
          <p className="text-ink-600 leading-relaxed">{s.body}</p>

          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 pt-2">
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
