/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (ondata di correzione 5-6) — DOPO «CONTINUA» SI TORNA SOLO A UNA PAGINA DEL SITO.
 *
 * La pagina che chiede di accettare Termini e Informativa riceve dove tornare nel
 * parametro `next`: lo mette il portiere quando ferma qualcuno sulla cassa o
 * nell'area del negozio. Il valore arriva dall'indirizzo, quindi chiunque puo'
 * scriverlo in un link. Si torna solo a un percorso interno: tutto il resto
 * porta alla home, con la stessa regola delle altre porte (`safeInternalPath`).
 *
 * La pagina e' quella vera; il router, l'indirizzo e la rete sono finti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({ cerca: '', sostituiti: [] as string[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (dove: string) => stato.sostituiti.push(dove), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(stato.cerca),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AccettaCondizioniPage from '@/app/accetta-condizioni/page';

let radice: Root;
let contenitore: HTMLDivElement;

async function accettaCon(cerca: string): Promise<string[]> {
  stato.cerca = cerca;
  stato.sostituiti = [];
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => { radice.render(createElement(AccettaCondizioniPage)); });
  const spunta = contenitore.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => { spunta.click(); });
  const continua = [...contenitore.querySelectorAll('button')].find((b) => b.textContent?.includes('Continua')) as HTMLButtonElement;
  await act(async () => { continua.click(); });
  return stato.sostituiti;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
});
afterEach(() => {
  act(() => radice?.unmount());
  contenitore?.remove();
  vi.unstubAllGlobals();
});

describe('dopo «Continua» la pagina dei Termini torna solo dentro il sito', () => {
  it('un indirizzo di un altro sito porta alla home', async () => {
    expect(await accettaCon('next=https://esempio.org/accedi')).toEqual(['/']);
  });

  it('un indirizzo che comincia con due barre porta alla home', async () => {
    expect(await accettaCon('next=//esempio.org')).toEqual(['/']);
  });

  it('la cassa da cui il portiere ha fermato la persona resta la cassa', async () => {
    expect(await accettaCon('next=/checkout')).toEqual(['/checkout']);
  });

  it('senza next si va alla home', async () => {
    expect(await accettaCon('')).toEqual(['/']);
  });
});
