/**
 * @vitest-environment jsdom
 */
/**
 * 1/11/2026 — IL SOS APRIVA IL 112 SOLO DOPO AVER ASPETTATO GPS E RETE.
 *
 * Alla conferma il pulsante faceva tre attese in fila: la posizione GPS (fino a 8 secondi),
 * poi una chiamata di rete per sapere chi è l'utente, poi la scrittura nel database. Solo
 * dopo apriva il tastierino col 112. Con poco segnale le due chiamate di rete restano
 * appese senza un tempo massimo, e il 112 non si apre mai.
 *
 * Qui il pulsante si MONTA e si preme davvero, nel caso peggiore: il GPS non risponde mai e
 * la rete resta appesa. La regola: il tastierino col 112 si apre subito, senza aspettare
 * niente; e l'avviso a MyCity, se la rete non risponde, si arrende entro un tempo massimo e
 * lo dice al fattorino invece di restare su «Invio…» per sempre.
 *
 * Come si vede che il tastierino si è aperto: jsdom non sa navigare verso `tel:` e lo
 * segnala su stderr come «navigation» non implementata. Contiamo quelle segnalazioni.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  insert: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
}));

const mai = () => new Promise<never>(() => undefined);

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: stato.getUser, getSession: stato.getSession },
    from: () => ({ insert: stato.insert }),
  },
}));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));

import SOSButton from '@/components/rider/SOSButton';

const accesi: Root[] = [];
let navigazioni: string[] = [];
let spia: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  navigazioni = [];
  // jsdom: assegnare location.href verso tel: scrive su stderr «Not implemented: navigation».
  const scriviVero = process.stderr.write.bind(process.stderr);
  spia = vi.spyOn(process.stderr, 'write').mockImplementation(((pezzo: unknown, ...resto: unknown[]) => {
    if (/navigation/i.test(String(pezzo))) { navigazioni.push(String(pezzo)); return true; }
    return (scriviVero as (...a: unknown[]) => boolean)(pezzo, ...resto);
  }) as never);
  // La rete è appesa: nessuna risposta, mai.
  stato.getUser.mockImplementation(mai);
  stato.getSession.mockImplementation(mai);
  stato.insert.mockImplementation(mai);
  // Il GPS non risponde mai (nemmeno con l'errore di timeout).
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: () => undefined },
  });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  spia?.mockRestore();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function confermaSOS() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(SOSButton, {})); });
  const apri = radice.querySelector<HTMLButtonElement>('button[aria-label="SOS emergenza"]');
  expect(apri).not.toBeNull();
  await act(async () => { apri!.click(); });
  const conferma = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /Conferma SOS/.test(b.textContent ?? ''));
  expect(conferma).toBeTruthy();
  await act(async () => { conferma!.click(); });
  return radice;
}

describe('il SOS apre il 112 prima di aspettare GPS e rete', () => {
  it('con GPS muto e rete appesa, il tastierino col 112 si apre subito', async () => {
    await confermaSOS();
    // Nessun timer fatto scorrere: il 112 non deve dipendere da nessuna attesa.
    await act(async () => { await Promise.resolve(); });
    expect(navigazioni.length).toBe(1);
  });

  // 5/11/2026 (sessione S02, scheda 2612) — col tempo scaduto la scrittura può ancora arrivare: il
  // messaggio dice «non sappiamo ancora», non «NON è stata avvisata».
  it('con la rete appesa, l’avviso si arrende entro un tempo massimo e dice che non si sa ancora se MyCity è avvisata', async () => {
    vi.useFakeTimers();
    await confermaSOS();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(stato.toastErr).toHaveBeenCalledTimes(1);
    expect(String(stato.toastErr.mock.calls[0][0])).toMatch(/Non sappiamo ancora se MyCity è stata avvisata/);
    expect(String(stato.toastErr.mock.calls[0][0])).toMatch(/premi subito CHIAMA/i);
    expect(stato.toastOk).not.toHaveBeenCalled();
    expect(navigazioni.length).toBe(1);
  });

  it('con la rete che risponde, l’evento parte con la posizione e il fattorino legge che MyCity è avvisata', async () => {
    stato.getSession.mockResolvedValue({ data: { session: { user: { id: 'rider-1' } } } });
    stato.getUser.mockResolvedValue({ data: { user: { id: 'rider-1' } } });
    stato.insert.mockResolvedValue({ error: null });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 45.05, longitude: 9.69 } }),
      },
    });
    await confermaSOS();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ rider_id: 'rider-1', lat: 45.05, lng: 9.69 });
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
    expect(navigazioni.length).toBe(1);
  });
});
