/**
 * @vitest-environment jsdom
 */
/**
 * Il selettore della posizione del negozio leggeva il limite della rotta come «servizio che non
 * risponde». La rotta /api/geocode ha un freno suo (30 ricerche al minuto da chi cerca: 429 con
 * `rate_limited`): lì il limite viene dalle ricerche del negozio, e il messaggio lo deve dire. Il
 * servizio delle mappe giù (503) o limitato (429 con `servizio_non_disponibile`) resta «non risponde».
 *
 * Gira la catena vera: il selettore montato (Leaflet finto), la rotta e la ricerca di
 * lib/geocodifica.ts. Finti sono solo il freno della rotta (acceso o spento) e il servizio delle mappe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const freno = vi.hoisted(() => ({ fermo: false }));

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: !freno.fermo }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => undefined, error: () => undefined, info: () => undefined } }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const sempreSe = (base: Record<string, unknown>): Record<string, unknown> => {
    const p: Record<string, unknown> = new Proxy(base, {
      get: (t, k) => (k === 'then' ? undefined : k in t ? t[k as string] : () => p),
    });
    return p;
  };
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: () => undefined } },
    map: () => sempreSe({}),
    tileLayer: () => sempreSe({}),
    marker: () => sempreSe({ getLatLng: () => ({ lat: 0, lng: 0 }) }),
  };
  return { default: L };
});

import StoreLocationPicker, { type StoreLocation } from '@/components/StoreLocationPicker';
import { POST } from '@/app/api/geocode/route';

let chiamateAlleMappe = 0;

function reteFinta(mappe: { status: number; corpo?: unknown }) {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/geocode') return POST(new Request('http://localhost/api/geocode', init));
    if (url.startsWith('https://nominatim.openstreetmap.org/search?')) {
      chiamateAlleMappe++;
      return new Response(mappe.status === 200 ? JSON.stringify(mappe.corpo ?? []) : '', { status: mappe.status });
    }
    throw new Error(`rete non prevista: ${url}`);
  });
}

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  freno.fermo = false;
  chiamateAlleMappe = 0;
  vi.unstubAllGlobals();
});

async function cerca(): Promise<{ testo: string; confermata: boolean }> {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onChange = vi.fn<(l: StoreLocation) => void>();
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(StoreLocationPicker, { defaultValue: {}, onChange }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const campo = radice.querySelector('input[type=text]') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(campo, 'Via Roma 10, Piacenza');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const bottone = [...radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Cerca'));
  expect(bottone, 'bottone Cerca non trovato').toBeTruthy();
  await act(async () => {
    bottone!.click();
    await new Promise((r) => setTimeout(r, 50));
  });
  return { testo: radice.textContent ?? '', confermata: onChange.mock.calls.some(([l]) => l.confermata) };
}

describe('il selettore distingue il limite della rotta dal servizio delle mappe che non risponde', () => {
  it('il freno della rotta (429 rate_limited): dice che le ricerche del negozio sono troppe, non che il servizio non risponde', async () => {
    freno.fermo = true;
    reteFinta({ status: 200 });
    const s = await cerca();
    expect(chiamateAlleMappe, 'col freno acceso la rotta non chiede alle mappe').toBe(0);
    expect(s.testo).toContain('troppe ricerche');
    expect(s.testo, 'il limite della rotta si leggeva come servizio che non risponde').not.toContain('non risponde');
    expect(s.testo).toContain('Riprova fra poco');
    expect(s.confermata).toBe(false);
  });

  it('le mappe dicono «troppe richieste» (429 dalle mappe): resta «il servizio non risponde»', async () => {
    reteFinta({ status: 429 });
    const s = await cerca();
    expect(s.testo).toContain('non risponde');
    expect(s.testo).not.toContain('troppe ricerche');
    expect(s.testo).not.toContain('Indirizzo non trovato');
  });

  it('le mappe sono giù (503 dalla rotta): resta «il servizio non risponde»', async () => {
    reteFinta({ status: 502 });
    const s = await cerca();
    expect(s.testo).toContain('non risponde');
    expect(s.testo).not.toContain('troppe ricerche');
  });

  it('nessun risultato (200 vuoto): «Indirizzo non trovato»', async () => {
    reteFinta({ status: 200, corpo: [] });
    const s = await cerca();
    expect(s.testo).toContain('Indirizzo non trovato');
    expect(s.testo).not.toContain('troppe ricerche');
  });
});
