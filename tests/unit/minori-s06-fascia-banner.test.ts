import { describe, it, expect } from 'vitest';
import { PROPORZIONI_FASCIA_BANNER } from '@/lib/banner-vetrina';

/**
 * S06 · 1503 — La fascia-banner è alta abbastanza per il testo a ogni gradino:
 * a 640 punti (sm, titolo a 30px) servono ~170 punti di testo più 48 di imbottitura.
 */
const GRADINI: Record<string, number> = { '': 0, sm: 640, md: 768, lg: 1024 };
function proporzioneA(schermo: number): number {
  let r = NaN;
  for (const [, pref, a, b] of PROPORZIONI_FASCIA_BANNER.matchAll(/(?:(\w+):)?aspect-\[(\d+)\/(\d+)\]/g)) {
    if (schermo >= GRADINI[pref ?? '']) r = Number(a) / Number(b);
  }
  return r;
}
describe('1503 — la fascia a ogni gradino', () => {
  it.each([[640, 218], [700, 218], [767, 218], [768, 218]])('a %i punti è alta almeno %i', (schermo, serve) => {
    const larghezza = schermo - 48; // container px-6
    expect(larghezza / proporzioneA(schermo)).toBeGreaterThanOrEqual(serve);
  });
});
