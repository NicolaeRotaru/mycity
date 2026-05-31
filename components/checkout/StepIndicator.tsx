'use client';

import { Check } from 'lucide-react';

/**
 * Step indicator visivo per il flow di checkout.
 *
 * Tre stati: done (spunta verde), active (numero su primary), pending (numero su grigio).
 * Estratto da app/checkout/page.tsx per ridurre LOC del monolite.
 */

type StepProps = {
  num: number;
  label: string;
  active?: boolean;
  done?: boolean;
};

function Step({ num, label, active, done }: StepProps) {
  return (
    <div className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done ? 'bg-olive-500 text-white' : active ? 'bg-primary-700 text-white' : 'bg-cream-200 text-ink-500'
        }`}
      >
        {done ? <Check size={15} strokeWidth={3} aria-hidden /> : num}
      </div>
      <span className={`text-sm font-semibold ${active ? 'text-primary-800' : done ? 'text-olive-700' : 'text-ink-400'}`}>
        {label}
      </span>
    </div>
  );
}

type StepDef = { num: number; label: string };

/** Step canonici del flusso d'acquisto, condivisi tra carrello e checkout. */
export const CHECKOUT_STEPS: StepDef[] = [
  { num: 1, label: 'Carrello' },
  { num: 2, label: 'Indirizzo' },
  { num: 3, label: 'Conferma' },
];

type Props = {
  steps: StepDef[];
  currentStep: number;
};

/**
 * Render della barra step. currentStep 1-based:
 *  - step.num < currentStep → done
 *  - step.num === currentStep → active
 *  - step.num > currentStep → pending
 */
export function StepIndicator({ steps, currentStep }: Props) {
  return (
    <div className="flex items-center justify-center gap-4 sm:gap-8 mb-8 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-4 sm:gap-8">
          <Step
            num={s.num}
            label={s.label}
            done={s.num < currentStep}
            active={s.num === currentStep}
          />
          {i < steps.length - 1 && <div className="w-8 sm:w-16 h-px bg-cream-300" />}
        </div>
      ))}
    </div>
  );
}
