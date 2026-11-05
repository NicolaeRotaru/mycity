// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * S10 (5/11/2026) — la risposta sulla consegna veloce nella scheda.
 * 2260: tornando a chiederla, il sì vecchio non si rivede.
 * 2298: si richiede quando la scheda torna visibile.
 */

import { useVeloceDelNegozio } from '@/components/ui/DeliveryCutoff';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const visti: Array<boolean | null> = [];
function Sonda({ chiedi }: { chiedi: boolean }) {
  visti.push(useVeloceDelNegozio('forno-1', chiedi));
  return null;
}

describe('la veloce della scheda (2260, 2298)', () => {
  it('chiedi vero → falso → vero con la risposta in sospeso: niente sì vecchio', async () => {
    let risposte = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      risposte++;
      return risposte === 1
        ? Promise.resolve(new Response(JSON.stringify({ possibile: true })))
        : new Promise(() => {}); // la seconda non arriva
    }));
    const c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(Sonda, { chiedi: true })));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(visti.at(-1)).toBe(true);
    await act(async () => root.render(createElement(Sonda, { chiedi: false })));
    visti.length = 0;
    await act(async () => root.render(createElement(Sonda, { chiedi: true })));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(visti.includes(true)).toBe(false);
  });

  it('quando la scheda torna visibile si richiede', async () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ possibile: true }))));
    vi.stubGlobal('fetch', f);
    const c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(Sonda, { chiedi: true })));
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('la riga della consegna non sposta il riquadro sul telefono (2299)', () => {
  it('la variante in linea riserva due righe sotto sm', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/ui/DeliveryCutoff.tsx', 'utf8');
    expect(src).toMatch(/inline-flex items-start gap-1\.5 text-sm text-olive-700 font-medium min-h-\[2\.5rem\] sm:min-h-0/);
  });
});
