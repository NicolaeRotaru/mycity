/**
 * @vitest-environment jsdom
 */
/**
 * R12-002 — Nella pagina che chiede di accettare i Termini, il bottone
 * «Continua» era spento senza dire che bisognava spuntare la casella; da
 * tastiera non si raggiungeva, e i link ai testi facevano perdere la spunta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({ sostituiti: [] as string[] }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (d: string) => stato.sostituiti.push(d), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AccettaCondizioniPage from '@/app/accetta-condizioni/page';

let radice: Root;
let c: HTMLDivElement;
const continua = () => [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Continua')) as HTMLButtonElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
  stato.sostituiti = [];
  c = document.createElement('div');
  document.body.appendChild(c);
  radice = createRoot(c);
  await act(async () => { radice.render(createElement(AccettaCondizioniPage)); });
});
afterEach(() => {
  act(() => radice.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('R12-002 «Continua» spiega cosa manca', () => {
  it('senza spunta il bottone si può premere (e raggiungere da tastiera)', () => {
    expect(continua().disabled).toBe(false);
    expect(continua().getAttribute('aria-disabled')).toBe('true');
  });

  it('premuto senza spunta: dice di spuntare la casella, lo collega al bottone e porta il fuoco sulla casella', async () => {
    await act(async () => { continua().click(); });
    const avviso = c.querySelector('[role="alert"]');
    expect(avviso?.textContent).toMatch(/Spunta la casella/);
    expect(continua().getAttribute('aria-describedby')).toBe(avviso?.id);
    expect(document.activeElement).toBe(c.querySelector('input[type="checkbox"]'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('con la spunta prosegue, e l avviso sparisce', async () => {
    await act(async () => { continua().click(); });
    await act(async () => { (c.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(c.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { continua().click(); });
    expect(stato.sostituiti).toEqual(['/']);
  });

  it('Termini e Informativa si aprono in una nuova scheda: la spunta non si perde', () => {
    for (const href of ['/terms', '/privacy']) {
      const a = c.querySelector(`a[href="${href}"]`) as HTMLAnchorElement;
      expect(a.target).toBe('_blank');
      expect(a.textContent).toMatch(/nuova scheda/);
    }
  });
});
