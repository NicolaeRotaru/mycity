import type { Firma } from '@/lib/armonia';

/**
 * IL SIGILLO (Nicola, 28/11/2026: «deve esserci magia») — l'intenzione dell'attività tracciata sul
 * quadrato magico di Saturno. Si disegna piccola e sottile: sembra un segno grafico qualunque.
 */
export default function SigilloNascosto({ firma, dimensione = 12, className = '' }: { firma: Firma; dimensione?: number; className?: string }) {
  if (!firma.sigillo) return null;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 100 100" width={dimensione} height={dimensione} className={className}>
      <path d={firma.sigillo} fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
