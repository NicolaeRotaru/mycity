import { fioreDellaVita, puntoAureo, rosaEtrusca, trama, type Firma, type Motivo } from '@/lib/armonia';

/**
 * LA TRAMA NASCOSTA (Nicola, 28/11/2026) — il motivo di sfondo che nasce dalla firma dell'attività,
 * quasi trasparente, dietro al contenuto. Chi la nota vede una trama; chi usa un lettore di schermo
 * non sente niente (aria-hidden). Respira piano, sei respiri al minuto; chi ha chiesto meno movimento
 * la vede ferma (regola globale in app/globals.css).
 *
 * Il genitore deve avere `position: relative` e `overflow: hidden`, e il contenuto sopra `relative`.
 */
type Props = {
  firma: Firma;
  /** Il motivo; senza, quello della firma. */
  motivo?: Motivo;
  /** Il disegno al punto aureo: il fiore della vita, la rosa etrusca, o niente. */
  centro?: 'fiore' | 'rosa' | null;
  /** Fra 0,03 e 0,08: sopra il testo non deve mai abbassarne il contrasto. */
  opacita?: number;
  larghezza?: number;
  altezza?: number;
  className?: string;
};

export default function TramaNascosta({ firma, motivo, centro = 'fiore', opacita = 0.06, larghezza = 610, altezza = 377, className = '' }: Props) {
  const d = trama(motivo ?? firma.motivo, larghezza, altezza, 34, firma.seme);
  const [cx, cy] = puntoAureo(larghezza, altezza, firma.seme + 1);
  const m = Math.min(larghezza, altezza);
  const disegno = centro === 'fiore' ? fioreDellaVita(cx, cy, m * 0.09) : centro === 'rosa' ? rosaEtrusca(cx, cy, m * 0.3) : '';
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${larghezza} ${altezza}`}
      preserveAspectRatio="xMidYMid slice"
      className={`armonia-respiro pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ opacity: Math.min(Math.max(opacita, 0), 0.08) }}
      data-armonia={motivo ?? firma.motivo}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {disegno && <path d={disegno} fill="none" stroke="currentColor" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
