'use client';

import { useId } from 'react';

/**
 * L'INTERRUTTORE CON UN NOME.
 *
 * 30/8/2026 (R105) — CINQUE INTERRUTTORI CHE SI ANNUNCIAVANO TUTTI UGUALI.
 *
 * Questo componente viveva dentro `app/profile/settings/page.tsx`, e lì il
 * comando era un `<button role="switch">` messo DENTRO un `<label>` che
 * conteneva titolo e descrizione. Ruolo e stato erano giusti; il nome no.
 *
 * Per un `<button>` il nome accessibile si prende da `aria-label`,
 * `aria-labelledby` o dal proprio contenuto — il `<label>` che lo avvolge i
 * browser NON lo usano: quella regola vale per i campi, non per i pulsanti. Il
 * contenuto qui è una `<span>` decorativa, la pallina che scorre, quindi il
 * nome restava vuoto. Nella pagina delle impostazioni account l'interruttore
 * compare cinque volte: una persona cieca sentiva «interruttore, attivato»
 * cinque volte di fila, indistinguibili. Poteva premerli senza sapere quale.
 * Criterio WCAG 4.1.2, livello A.
 *
 * Adesso titolo e descrizione hanno un id (con `useId`, come già fa
 * `components/ui/Field.tsx`), il pulsante li nomina con `aria-labelledby` e
 * `aria-describedby`, e il `<label>` esterno è tornato un `<div>`: su un
 * pulsante non serviva, e faceva credere che il nome ci fosse.
 *
 * Il freno che lo tiene chiuso:
 * tests/unit/gli-interruttori-delle-impostazioni-dicono-il-proprio-nome.test.ts
 * — monta la pagina vera e chiede a ogni interruttore il nome che un browser
 * calcolerebbe.
 */
export function Toggle({
  label, desc, value, onChange,
}: {
  /** Cosa si accende, detto in parole: è il nome che sente chi non vede. */
  label: string;
  /** La riga sotto, che spiega cosa comporta. */
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const idTitolo = useId();
  const idDesc = useId();
  return (
    <div className="flex items-start justify-between gap-4 p-3 border rounded-lg hover:bg-cream-50">
      <div>
        <div id={idTitolo} className="font-semibold">{label}</div>
        <div id={idDesc} className="text-xs text-ink-500">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={idTitolo}
        aria-describedby={idDesc}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-primary-700' : 'bg-cream-300'
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default Toggle;
