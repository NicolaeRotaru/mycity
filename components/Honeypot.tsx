'use client';

import { useId } from 'react';

/**
 * Campo trappola anti-spam: invisibile a un essere umano (off-screen,
 * tabIndex -1, autocomplete=off) ma i bot riempiono ciecamente ogni input
 * presente nel form. Se al submit risulta valorizzato, scartiamo la
 * richiesta.
 *
 * Uso:
 *   const honeypot = useRef('');
 *   <Honeypot value={honeypot.current} onChange={(v) => (honeypot.current = v)} />
 *   ...
 *   if (honeypot.current) return; // bot
 */

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Nome del campo che il bot vedrà. Volutamente "comune" tipo company / website. */
  name?: string;
};

export default function Honeypot({ value, onChange, name = 'company_website' }: Props) {
  // L'identificativo nasceva dal nome del campo, che e' una costante: due moduli con la stessa
  // trappola nella stessa pagina — il pie' di pagina e la sezione newsletter della home — davano
  // due volte `id="hp-company"` e due etichette che puntavano allo stesso posto. `useId` ne da'
  // uno diverso per ogni copia, e il nome resta libero di fare l'esca per i robot.
  const campoId = useId();
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '-10000px',
        top: 'auto',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
    >
      <label htmlFor={campoId}>
        Non compilare se sei umano
        <input
          id={campoId}
          type="text"
          name={name}
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
