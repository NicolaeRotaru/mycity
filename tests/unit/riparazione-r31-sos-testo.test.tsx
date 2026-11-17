/**
 * @vitest-environment jsdom
 */
/**
 * R31-001 — Il SOS del fattorino non promette una chiamata che l'app non fa partire.
 *
 * `window.location.href = 'tel:112'` apre il telefono con il 112 già scritto: la chiamata parte
 * solo se il fattorino preme CHIAMA. I messaggi dopo la conferma lo dicevano già; il dialogo di
 * conferma diceva ancora «Verrà avviata la chiamata al 112». Qui il pulsante vero si monta, si apre
 * il dialogo e si legge quello che il fattorino ha davanti prima di confermare; poi si conferma e si
 * controlla che nessun testo visto dal fattorino prometta una chiamata già partita.
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

// Ogni modo di dire che la chiamata parte da sola, o che è già in corso.
const PROMESSA_DI_CHIAMATA = /avviata la chiamata|verrà chiamato|stiamo chiamando|chiamata .{0,20}in corso|ti stiamo collegando|chiamiamo (noi|il 112)/i;

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

describe('R31-001 · il dialogo del SOS dice quello che succede davvero', () => {
  it('prima di confermare: il dialogo non promette la chiamata, dice che il 112 è già scritto e CHIAMA lo premi tu', async () => {
    const dialogo = await apriDialogo();
    const testo = (dialogo.textContent ?? '').replace(/\s+/g, ' ');
    expect(testo, 'la vecchia promessa non deve più comparire').not.toMatch(PROMESSA_DI_CHIAMATA);
    expect(testo).toMatch(/112 \(numero unico emergenze\)/);
    expect(testo).toMatch(/già scritto/);
    expect(testo).toMatch(/la chiamata parte solo quando premi tu CHIAMA/);
  });

  it('dopo la conferma nessun testo, né il dialogo né i messaggi, dice che la chiamata è partita', async () => {
    const dialogo = await apriDialogo();
    const testoDialogo = dialogo.textContent ?? '';
    await act(async () => { within(dialogo).getByRole('button', { name: /Conferma SOS/ }).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const messaggi = [...stato.toastOk.mock.calls, ...stato.toastErr.mock.calls].map((c) => String(c[0]));
    expect(messaggi.length).toBeGreaterThan(0);
    for (const t of [testoDialogo, ...messaggi]) expect(t).not.toMatch(PROMESSA_DI_CHIAMATA);
  });
});
