'use client';

import { useSyncExternalStore } from 'react';
import { faseLuna, tracciatoLuna } from '@/lib/armonia/cielo';

/**
 * LA LUNA DI OGGI (Nicola, 28/11/2026) — un puntino che segue la fase vera della luna.
 * Sembra un dettaglio grafico; la notte di luna piena ha un alone leggero.
 * Sul server non si disegna la fase (la pagina può restare in cache per giorni): solo il cerchio.
 */
const ORA_MS = 3_600_000;
const nessunaIscrizione = () => () => {};
/** La fase all'inizio dell'ora: resta uguale fra due letture, come vuole useSyncExternalStore. */
const faseDellOra = () => faseLuna(Math.floor(Date.now() / ORA_MS) * ORA_MS);
const sulServer = () => null;

export default function LunaDiOggi({ dimensione = 12, className = '' }: { dimensione?: number; className?: string }) {
  const fase = useSyncExternalStore(nessunaIscrizione, faseDellOra, sulServer);
  const piena = fase !== null && Math.abs(fase - 0.5) < 0.03;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-12 -12 24 24"
      width={dimensione}
      height={dimensione}
      className={className}
      data-fase={fase === null ? undefined : fase.toFixed(3)}
    >
      {piena && <circle r={11.5} fill="currentColor" opacity={0.15} />}
      <circle r={10} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.45} />
      {fase !== null && <path d={tracciatoLuna(fase, 10)} fill="currentColor" />}
    </svg>
  );
}
