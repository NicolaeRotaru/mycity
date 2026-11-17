/**
 * @vitest-environment jsdom
 */
/**
 * R02-004 — Il dialogo dell'SOS diceva che gli amministratori ricevono l'avviso «subito». Non è
 * vero in assoluto: l'avviso parte dopo l'attesa della posizione, solo se la scrittura dell'SOS
 * riesce, e il push agli amministratori parte solo dopo quella scrittura. Con poca rete arriva in
 * ritardo o non arriva. Qui si apre il dialogo vero e si legge la riga sugli amministratori.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn() }, from: () => ({ insert: vi.fn() }) },
}));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SOSButton from '@/components/rider/SOSButton';

const accesi: Root[] = [];

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function rigaAmministratori(): Promise<string> {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => undefined } });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(SOSButton, {})); });
  await act(async () => { screen.getByRole('button', { name: 'SOS emergenza' }).click(); });
  const righe = Array.from(screen.getByRole('dialog').querySelectorAll('li')).map((li) => li.textContent ?? '');
  const riga = righe.find((t) => /amministratori/i.test(t));
  expect(riga, 'il dialogo deve dire cosa arriva agli amministratori').toBeTruthy();
  return riga!;
}

describe('R02-004 · il dialogo dell’SOS non promette agli amministratori un avviso «subito»', () => {
  it('la frase sugli amministratori non dice «subito» (il «subito» resta solo per il 112)', async () => {
    const riga = await rigaAmministratori();
    const sugliAmministratori = riga.split(/Non aspettare loro/)[0];
    expect(sugliAmministratori).not.toMatch(/subito|immediatamente|all'istante|in tempo reale/i);
    expect(riga).toMatch(/per l'aiuto subito c'è il 112/);
  });

  it('dice che l’avviso dipende dalla connessione e può arrivare in ritardo o non arrivare', async () => {
    const riga = await rigaAmministratori();
    expect(riga).toMatch(/connesso/);
    expect(riga).toMatch(/in ritardo o non arrivare/);
  });
});
