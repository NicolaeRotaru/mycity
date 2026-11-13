/**
 * @vitest-environment jsdom
 */
/**
 * R16-009 — Il pulsante SOS chiedeva la posizione DOPO aver aperto il tastierino del 112.
 *
 * Col tastierino aperto la pagina va in secondo piano, e il telefono può non dare più la
 * posizione: l'avviso a MyCity partiva senza coordinate. Qui il GPS finto si comporta così:
 * se la posizione gli viene chiesta con la pagina ancora davanti (prima di `tel:`) risponde;
 * se gli viene chiesta dopo che il tastierino si è aperto, non risponde mai.
 *
 * Come si vede che il tastierino si è aperto: jsdom non sa navigare verso `tel:` e lo scrive
 * su stderr, nello stesso istante dell'assegnazione. Lo si conta lì, in ordine col GPS.
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

const accesi: Root[] = [];
let ordine: string[] = [];
let spia: { mockRestore: () => void } | null = null;

/** GPS finto: risponde solo se la posizione è chiesta prima che il tastierino si apra. */
function gpsCheRispondeSoloInPrimoPiano() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) => {
        const inPrimoPiano = !ordine.includes('tel');
        ordine.push('gps');
        if (inPrimoPiano) setTimeout(() => ok({ coords: { latitude: 45.0526, longitude: 9.6929 } }), 200);
        // in secondo piano: nessuna risposta, mai (nemmeno l'errore)
      },
    },
  });
}

beforeEach(() => {
  ordine = [];
  const scriviVero = process.stderr.write.bind(process.stderr);
  spia = vi.spyOn(process.stderr, 'write').mockImplementation(((pezzo: unknown, ...resto: unknown[]) => {
    if (/navigation/i.test(String(pezzo))) { ordine.push('tel'); return true; }
    return (scriviVero as (...a: unknown[]) => boolean)(pezzo, ...resto);
  }) as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  stato.getSession.mockResolvedValue({ data: { session: { user: { id: 'rider-1' } } } });
  stato.insert.mockResolvedValue({ error: null });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  spia?.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function confermaSOS() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(SOSButton, { orderId: undefined })); });
  await act(async () => { screen.getByRole('button', { name: 'SOS emergenza' }).click(); });
  const dialogo = screen.getByRole('dialog');
  await act(async () => { within(dialogo).getByRole('button', { name: /Conferma SOS/ }).click(); });
}

describe('R16-009 · l’SOS chiede la posizione prima di aprire il 112, e l’avviso parte con le coordinate', () => {
  it('la posizione si chiede prima del tastierino, e l’avviso a MyCity porta le coordinate', async () => {
    vi.useFakeTimers();
    gpsCheRispondeSoloInPrimoPiano();
    await confermaSOS();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(ordine).toEqual(['gps', 'tel']);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ rider_id: 'rider-1', lat: 45.0526, lng: 9.6929 });
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
  });

  it('il tastierino non aspetta il GPS: si apre subito anche se la posizione non arriva, e l’avviso parte lo stesso', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => { ordine.push('gps'); } },
    });
    await confermaSOS();
    // Nessun timer fatto scorrere: il tastierino è già aperto.
    expect(ordine).toEqual(['gps', 'tel']);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ rider_id: 'rider-1', lat: null, lng: null });
  });
});
