'use client';

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
      <label htmlFor={`hp-${name}`}>
        Non compilare se sei umano
        <input
          id={`hp-${name}`}
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
