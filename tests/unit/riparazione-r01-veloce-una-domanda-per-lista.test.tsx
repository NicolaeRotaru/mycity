// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R01-006 — L'ELENCO DEI NEGOZI FACEVA UNA DOMANDA SULLA VELOCE PER OGNI SCHEDA.
 *
 * Ogni scheda (StoreListRow, StorePreviewCard) chiama useVeloceDelNegozio col suo negozio: prima
 * 12 schede = 12 domande a /api/consegna/veloce, nello stesso istante e contro il freno della
 * rotta. Ora le schede di uno stesso disegno fanno una domanda sola, e ognuna mostra comunque la
 * risposta del SUO negozio.
 *
 * Il finto della rotta risponde come quella vera: per il gruppo intero (`veloceSiPuo` sui negozi
 * chiesti), quindi «no» se anche uno solo sta per chiudere, e la regola generale (orario della
 * veloce, fattorini) quando i negozi chiesti sono zero.
 */

import { useVeloceDelNegozio } from '@/components/ui/DeliveryCutoff';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function Scheda({ id }: { id: string }) {
  const veloce = useVeloceDelNegozio(id, true);
  return createElement('span', { 'data-negozio': id }, String(veloce));
}

function Lista({ ids }: { ids: string[] }) {
  return createElement('div', null, ...ids.map((id) => createElement(Scheda, { key: id, id })));
}

/** La rotta finta: `chiusi` sono i negozi che stanno per chiudere, `generale` la regola senza negozi. */
function rottaFinta({ chiusi = [] as string[], generale = true, guasto = false } = {}) {
  const domande: string[][] = [];
  const f = vi.fn(async (url: string) => {
    const negozi = (new URL(url, 'http://x').searchParams.get('negozi') ?? '').split(',').filter(Boolean);
    domande.push(negozi);
    if (guasto) return new Response(JSON.stringify({ possibile: false }), { status: 503 });
    if (negozi.length > 20) return new Response(JSON.stringify({ possibile: false }), { status: 400 });
    const possibile = generale && negozi.every((n) => !chiusi.includes(n));
    return new Response(JSON.stringify({ possibile }));
  });
  vi.stubGlobal('fetch', f);
  return { f, domande };
}

async function disegna(ids: string[]) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(Lista, { ids })));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  const mostra = (id: string) => c.querySelector(`[data-negozio="${id}"]`)?.textContent;
  return mostra;
}

const negozi = (n: number) => Array.from({ length: n }, (_, i) => `negozio-${i + 1}`);

describe('R01-006 · la veloce sull elenco dei negozi', () => {
  it('12 schede nella stessa pagina fanno una sola domanda, con tutti i negozi', async () => {
    const { f, domande } = rottaFinta();
    const ids = negozi(12);
    const mostra = await disegna(ids);
    expect(f, 'una domanda per scheda invece di una per tutta la lista').toHaveBeenCalledTimes(1);
    expect([...domande[0]].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(mostra(id)).toBe('true');
  });

  it('un negozio che sta per chiudere: lui dice no, gli altri sì', async () => {
    const { f } = rottaFinta({ chiusi: ['negozio-3'] });
    const ids = negozi(12);
    const mostra = await disegna(ids);
    for (const id of ids) expect(mostra(id), id).toBe(id === 'negozio-3' ? 'false' : 'true');
    expect(f.mock.calls.length).toBeLessThan(ids.length);
  });

  it('due negozi su sette stanno per chiudere: ognuno ha la sua risposta', async () => {
    rottaFinta({ chiusi: ['negozio-2', 'negozio-6'] });
    const ids = negozi(7);
    const mostra = await disegna(ids);
    for (const id of ids) expect(mostra(id), id).toBe(id === 'negozio-2' || id === 'negozio-6' ? 'false' : 'true');
  });

  it('nessun fattorino: no per tutti, senza una domanda per scheda', async () => {
    const { f } = rottaFinta({ generale: false });
    const ids = negozi(10);
    const mostra = await disegna(ids);
    for (const id of ids) expect(mostra(id)).toBe('false');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('la rotta in errore: «non so» per tutti, come prima', async () => {
    const { f } = rottaFinta({ guasto: true });
    const ids = negozi(6);
    const mostra = await disegna(ids);
    for (const id of ids) expect(mostra(id)).toBe('null');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('oltre i 20 negozi che la rotta accetta: una domanda ogni 20', async () => {
    const { f, domande } = rottaFinta();
    const ids = negozi(25);
    const mostra = await disegna(ids);
    expect(f).toHaveBeenCalledTimes(2);
    expect(domande.every((d) => d.length <= 20)).toBe(true);
    for (const id of ids) expect(mostra(id)).toBe('true');
  });
});
