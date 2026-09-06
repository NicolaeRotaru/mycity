'use client';

import { Check } from 'lucide-react';

/**
 * La barra dei passi del percorso d'acquisto: carrello → cassa → conferma.
 *
 * 6/9/2026 — DUE DIFETTI, E STAVANO NELLO STESSO POSTO.
 *
 * ① I NUMERI SI SCONTRAVANO CON QUELLI SOTTO. In cima alla cassa questa barra diceva
 *    «1 Carrello · 2 Indirizzo · 3 Conferma»; poche righe più giù partivano le schede numerate
 *    «1 Indirizzo di consegna · 2 Quando vuoi riceverlo · 3 Come paghi». Due numerazioni
 *    sovrapposte, in cui il «3» in alto e il «3» in basso volevano dire cose diverse. I numeri qui
 *    non servivano: le etichette dicono già dove sei, e su schermo stretto lo dice per esteso la
 *    riga «Passo 2 di 3». Restano solo là dove sono l'unica numerazione, cioè nelle schede.
 *
 * ② SUI TELEFONI STRETTI ANDAVA A CAPO. Tre cerchi da 28 pixel, due trattini, i distanziatori e
 *    tre etichette non stanno nei ~343 pixel utili di un iPhone SE, e il contenitore aveva
 *    `flex-wrap`: il terzo passo scendeva sotto gli altri due. Sotto i 640 pixel adesso si legge
 *    una riga sola con la barretta di avanzamento, e non c'è più niente che possa andare a capo.
 */

type StepProps = {
  label: string;
  active?: boolean;
  done?: boolean;
};

function Step({ label, active, done }: StepProps) {
  return (
    <div className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done ? 'bg-olive-600 text-white' : active ? 'bg-primary-700 text-white' : 'bg-cream-200 text-ink-500'
        }`}
      >
        {done ? (
          <Check size={15} strokeWidth={3} aria-hidden />
        ) : (
          <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
        )}
      </div>
      {/* 27/8/2026 (R110) — il passo non ancora raggiunto era `text-ink-400`:
          sul fondo pagina cream-100 stacca 4,49 volte, appena sotto il 4,5 che
          serve a un testo normale. `ink-500` arriva a 7,14 e resta grigio. */}
      <span className={`text-sm font-semibold ${active ? 'text-primary-800' : done ? 'text-olive-700' : 'text-ink-500'}`}>
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
  const corrente = steps.find((s) => s.num === currentStep);
  const quanti = Math.max(1, steps.length);
  const avanzamento = Math.min(100, Math.max(0, (currentStep / quanti) * 100));

  return (
    <nav aria-label="A che punto sei dell'ordine" className="mb-8">
      {/* Schermo stretto: una riga sola. Niente cerchi, niente trattini, niente da mandare a capo. */}
      <div className="sm:hidden">
        <p className="text-sm font-semibold text-ink-700">
          <span className="text-primary-800">Passo {currentStep} di {quanti}</span>
          {corrente && ` · ${corrente.label}`}
        </p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-cream-200">
          <div className="h-full rounded-full bg-primary-700" style={{ width: `${avanzamento}%` }} aria-hidden />
        </div>
      </div>

      {/* Da 640 pixel in su i tre passi ci stanno per esteso, su una riga sola. */}
      <div className="hidden sm:flex items-center justify-center gap-8">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-8">
            <Step
              label={s.label}
              done={s.num < currentStep}
              active={s.num === currentStep}
            />
            {i < steps.length - 1 && <div className="w-16 h-px bg-cream-300" aria-hidden />}
          </div>
        ))}
      </div>
    </nav>
  );
}
