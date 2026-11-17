/**
 * @vitest-environment jsdom
 */
/**
 * R02-005 — Se il primo tentativo del GPS (getCurrentPosition) scadeva, l'attesa della posizione
 * si chiudeva subito con «nessuna posizione», anche se il watch restava in ascolto: la posizione
 * che il watch portava un attimo dopo non finiva più nell'avviso, e l'SOS partiva senza coordinate.
 *
 * Qui il GPS finto fa scadere il primo tentativo dopo 5 secondi (errore TIMEOUT, code 3) e il watch
 * porta la posizione un attimo dopo. Si guarda cosa contiene la riga scritta in rider_sos_events.
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

type Ok = (p: unknown) => void;
type Ko = (e: { code: number; message: string }) => void;

const accesi: Root[] = [];
let spia: { mockRestore: () => void } | null = null;
/** Il callback di successo del watch: il test lo chiama quando «arriva» la posizione. */
let watchOk: Ok | null = null;

const PIACENZA = { coords: { latitude: 45.0526, longitude: 9.6929 } };

/** Il primo tentativo scade dopo `scadeDopoMs` con l'errore dato; il watch resta in ascolto. */
function gpsColPrimoTentativoCheScade(errore: { code: number; message: string }, scadeDopoMs = 5_000) {
  watchOk = null;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: Ok, ko: Ko) => { setTimeout(() => ko(errore), scadeDopoMs); },
      watchPosition: (ok: Ok) => { watchOk = ok; return 1; },
      clearWatch: () => undefined,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom non sa aprire `tel:` e lo scrive su stderr: qui lo si tace.
  const scriviVero = process.stderr.write.bind(process.stderr);
  spia = vi.spyOn(process.stderr, 'write').mockImplementation(((pezzo: unknown, ...resto: unknown[]) => {
    if (/navigation/i.test(String(pezzo))) return true;
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

async function apriDialogo() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(SOSButton, {})); });
  await act(async () => { screen.getByRole('button', { name: 'SOS emergenza' }).click(); });
}

async function conferma() {
  await act(async () => { within(screen.getByRole('dialog')).getByRole('button', { name: /Conferma SOS/ }).click(); });
}

async function avanza(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function arrivaDalWatch() {
  expect(watchOk).not.toBeNull();
  await act(async () => { watchOk!(PIACENZA); });
}

describe('R02-005 · l’SOS porta la posizione che arriva dopo il primo tentativo scaduto', () => {
  it('primo tentativo scaduto PRIMA della conferma, posizione dal watch subito dopo la conferma: l’avviso porta le coordinate', async () => {
    gpsColPrimoTentativoCheScade({ code: 3, message: 'Timeout expired' });
    await apriDialogo();
    await avanza(5_100); // il primo tentativo è scaduto
    await conferma();
    await avanza(300);
    await arrivaDalWatch();
    await avanza(10_000);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ rider_id: 'rider-1', lat: 45.0526, lng: 9.6929 });
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
  });

  it('conferma prima che il primo tentativo scada, posizione dal watch un attimo dopo la scadenza: l’avviso porta le coordinate', async () => {
    gpsColPrimoTentativoCheScade({ code: 3, message: 'Timeout expired' });
    await apriDialogo();
    await avanza(1_000);
    await conferma();
    await avanza(4_100); // il primo tentativo scade qui (5 s dall'apertura)
    await avanza(200);
    await arrivaDalWatch();
    await avanza(10_000);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ lat: 45.0526, lng: 9.6929 });
  });

  it('segnale non trovato al primo tentativo (code 2), posizione dal watch dopo: l’avviso porta le coordinate', async () => {
    gpsColPrimoTentativoCheScade({ code: 2, message: 'Position unavailable' }, 800);
    await apriDialogo();
    await avanza(1_000);
    await conferma();
    await avanza(2_000);
    await arrivaDalWatch();
    await avanza(10_000);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ lat: 45.0526, lng: 9.6929 });
  });

  it('il watch non porta niente: l’avviso parte lo stesso, senza posizione, entro il tempo massimo del GPS', async () => {
    gpsColPrimoTentativoCheScade({ code: 3, message: 'Timeout expired' });
    await apriDialogo();
    await avanza(5_100);
    await conferma();
    await avanza(6_000); // TEMPO_MASSIMO_GPS_MS + 500 dalla conferma
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ rider_id: 'rider-1', lat: null, lng: null });
  });

  it('permesso negato (code 1): l’avviso non aspetta il watch e parte subito senza posizione', async () => {
    gpsColPrimoTentativoCheScade({ code: 1, message: 'User denied Geolocation' }, 10);
    await apriDialogo();
    await avanza(100);
    await conferma();
    await avanza(50);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ lat: null, lng: null });
  });
});
