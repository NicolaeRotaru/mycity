/**
 * @vitest-environment jsdom
 */
/**
 * R12-016 — Chi arrivava alla pagina dei Termini senza essere entrato (sessione
 * scaduta, cookie cancellati) leggeva «Registrazione non riuscita» e non
 * trovava la strada per accedere: ogni risposta non buona diventava quella
 * frase. La pagina è quella vera; router, rete e avvisi sono finti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({ cerca: 'next=/checkout', sostituiti: [] as string[], errori: [] as string[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (dove: string) => stato.sostituiti.push(dove), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(stato.cerca),
}));
vi.mock('sonner', () => ({ toast: { error: (m: string) => stato.errori.push(m), success: vi.fn() } }));

import AccettaCondizioniPage from '@/app/accetta-condizioni/page';

let radice: Root;
let contenitore: HTMLDivElement;

async function accettaConRisposta(status: number, corpo: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => corpo })));
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => { radice.render(createElement(AccettaCondizioniPage)); });
  const spunta = contenitore.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => { spunta.click(); });
  const continua = [...contenitore.querySelectorAll('button')].find((b) => b.textContent?.includes('Continua')) as HTMLButtonElement;
  await act(async () => { continua.click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stato.sostituiti = [];
  stato.errori = [];
});
afterEach(() => {
  act(() => radice?.unmount());
  contenitore?.remove();
  vi.unstubAllGlobals();
});

describe('R12-016 i Termini senza sessione mandano all accesso', () => {
  it('401: dice di accedere e porta all accesso, con il ritorno qui e poi alla cassa', async () => {
    await accettaConRisposta(401);
    expect(stato.errori.join(' ')).not.toMatch(/Registrazione non riuscita/);
    expect(stato.errori.join(' ')).toMatch(/accedi/i);
    expect(stato.sostituiti).toHaveLength(1);
    const dove = new URL(stato.sostituiti[0], 'http://x');
    expect(dove.pathname).toBe('/sign-in');
    expect(dove.searchParams.get('returnTo')).toBe('/accetta-condizioni?next=%2Fcheckout');
  });

  it('429: dice di riprovare fra poco', async () => {
    await accettaConRisposta(429);
    expect(stato.errori.join(' ')).toMatch(/riprova fra un minuto/i);
    expect(stato.sostituiti).toEqual([]);
  });

  it('500: non parla di una registrazione', async () => {
    await accettaConRisposta(500, { ok: false, error: { code: 'internal', message: 'Errore interno' } });
    expect(stato.errori).toHaveLength(1);
    expect(stato.errori[0]).not.toMatch(/Registrazione/);
    expect(stato.sostituiti).toEqual([]);
  });
});
