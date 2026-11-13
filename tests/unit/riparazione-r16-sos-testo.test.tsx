/**
 * @vitest-environment jsdom
 */
/**
 * R16-001 — Il SOS del fattorino non deve promettere una chiamata che l'app non fa.
 *
 * `window.location.href = 'tel:112'` apre il telefono con il 112 già scritto: la chiamata parte
 * solo se il fattorino preme CHIAMA. Il dialogo di conferma diceva «Verrà avviata la chiamata al
 * 112», come se partisse da sola. Qui il pulsante si monta, si apre il dialogo, si conferma, e si
 * legge quello che il fattorino vede davvero: il dialogo e il messaggio dopo la conferma.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen, within } from '@testing-library/dom';

const stato = vi.hoisted(() => ({
  insert: vi.fn(),
  getSession: vi.fn(),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: stato.getSession },
    from: () => ({ insert: stato.insert }),
  },
}));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));

import SOSButton from '@/components/rider/SOSButton';

const PROMESSA_DI_CHIAMATA = /avviata la chiamata|stiamo chiamando|chiamata .{0,20}in corso|ti stiamo collegando/i;

const accesi: Root[] = [];
let spia: { mockRestore: () => void } | null = null;

beforeEach(() => {
  // jsdom non sa aprire `tel:` e lo scrive su stderr: qui lo si tace, non serve alla prova.
  const scriviVero = process.stderr.write.bind(process.stderr);
  spia = vi.spyOn(process.stderr, 'write').mockImplementation(((pezzo: unknown, ...resto: unknown[]) => {
    if (/navigation/i.test(String(pezzo))) return true;
    return (scriviVero as (...a: unknown[]) => boolean)(pezzo, ...resto);
  }) as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  stato.getSession.mockResolvedValue({ data: { session: { user: { id: 'rider-1' } } } });
  stato.insert.mockResolvedValue({ error: null });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 45.05, longitude: 9.69 } }) },
  });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  spia?.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function apriDialogo() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(SOSButton, {})); });
  await act(async () => { screen.getByRole('button', { name: 'SOS emergenza' }).click(); });
  return screen.getByRole('dialog');
}

describe('R16-001 · il SOS dice quello che fa davvero: apre il telefono col 112, la chiamata la fa partire il fattorino', () => {
  it('il dialogo di conferma non promette una chiamata, dice che CHIAMA lo preme il fattorino', async () => {
    const dialogo = await apriDialogo();
    const testo = dialogo.textContent ?? '';
    expect(testo).not.toMatch(PROMESSA_DI_CHIAMATA);
    expect(testo).toMatch(/112/);
    expect(testo).toMatch(/già scritto/);
    expect(testo).toMatch(/premi tu CHIAMA/);
  });

  it('dopo la conferma, con l’avviso scritto, il messaggio dice che MyCity è avvisata e che CHIAMA va premuto', async () => {
    const dialogo = await apriDialogo();
    await act(async () => { within(dialogo).getByRole('button', { name: /Conferma SOS/ }).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
    const messaggio = String(stato.toastOk.mock.calls[0][0]);
    expect(messaggio).not.toMatch(PROMESSA_DI_CHIAMATA);
    expect(messaggio).toMatch(/MyCity è stata avvisata/);
    expect(messaggio).toMatch(/premi CHIAMA/);
  });

  it('dopo la conferma, se l’avviso non parte, il messaggio dice che MyCity NON è avvisata e che CHIAMA va premuto', async () => {
    stato.insert.mockResolvedValue({ error: { message: 'rifiutato' } });
    const dialogo = await apriDialogo();
    await act(async () => { within(dialogo).getByRole('button', { name: /Conferma SOS/ }).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(stato.toastErr).toHaveBeenCalledTimes(1);
    const messaggio = String(stato.toastErr.mock.calls[0][0]);
    expect(messaggio).not.toMatch(PROMESSA_DI_CHIAMATA);
    expect(messaggio).toMatch(/NON è stata avvisata/);
    expect(messaggio).toMatch(/premi subito CHIAMA/i);
  });
});
