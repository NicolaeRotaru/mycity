/**
 * @vitest-environment jsdom
 */
/**
 * La posizione del negozio poteva finire lontano da Piacenza: il negozio che scrive solo la via.
 *
 * Il selettore mandava «Via Roma 12, Italia». Senza città la ricerca (lib/geocodifica.ts) resta un
 * testo libero dentro il riquadro di Piacenza e dintorni, e il primo risultato poteva essere la Via
 * Roma di Podenzano, a 10 km: dentro il riquadro, quindi confermata, e il negozio non riceveva
 * consegne dai clienti di Piacenza. Ora, se la città manca, si cerca a Piacenza.
 *
 * Qui gira tutta la catena vera: il selettore montato (Leaflet finto), la rotta /api/geocode e la
 * ricerca di lib/geocodifica.ts. Finto è solo il servizio delle mappe, che risponde come Nominatim:
 * in forma strutturata dà le vie del comune chiesto, a testo libero la prima Via Roma che trova.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true }),
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

const VIA_ROMA = {
  piacenza: { lat: '45.0497', lon: '9.6985', display_name: 'Via Roma, Centro Storico, Piacenza, Emilia-Romagna, Italia', address: { city: 'Piacenza', postcode: '29121' } },
  podenzano: { lat: '44.9551', lon: '9.6842', display_name: 'Via Roma, Podenzano, Piacenza, Emilia-Romagna, Italia', address: { village: 'Podenzano', county: 'Piacenza', postcode: '29027' } },
};

const domandeAlleMappe: URLSearchParams[] = [];

/** Il servizio delle mappe finto, come Nominatim: strutturata → il comune chiesto; testo libero → la prima Via Roma. */
function mappe(p: URLSearchParams): unknown[] {
  const citta = (p.get('city') ?? '').toLowerCase();
  if (citta) return citta === 'piacenza' ? [VIA_ROMA.piacenza] : citta === 'podenzano' ? [VIA_ROMA.podenzano] : [];
  const q = (p.get('q') ?? '').toLowerCase();
  return q.includes('piacenza') ? [VIA_ROMA.piacenza, VIA_ROMA.podenzano] : [VIA_ROMA.podenzano, VIA_ROMA.piacenza];
}

function reteFinta() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/geocode') return POST(new Request('http://localhost/api/geocode', init));
    if (url.startsWith('https://nominatim.openstreetmap.org/search?')) {
      const p = new URL(url).searchParams;
      domandeAlleMappe.push(p);
      return new Response(JSON.stringify(mappe(p)), { status: 200 });
    }
    throw new Error(`rete non prevista: ${url}`);
  });
}

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  domandeAlleMappe.length = 0;
  vi.unstubAllGlobals();
});

async function cercaNelSelettore(indirizzo: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  reteFinta();
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
    set.call(campo, indirizzo);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const bottone = [...radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Cerca'));
  expect(bottone, 'bottone Cerca non trovato').toBeTruthy();
  await act(async () => {
    bottone!.click();
    await new Promise((r) => setTimeout(r, 50));
  });
  const confermate = onChange.mock.calls.map(([l]) => l).filter((l) => l.confermata);
  return { confermate, ultima: onChange.mock.calls.at(-1)?.[0] as StoreLocation, testo: radice.textContent ?? '' };
}

const PODENZANO = { lat: 44.9551, lng: 9.6842 };
const PIACENZA = { lat: 45.0497, lng: 9.6985 };

describe('il negozio che scrive solo la via finisce a Piacenza, non nella Via Roma di un altro comune', () => {
  for (const indirizzo of ['Via Roma 12', 'Via Roma, 12', 'Via Roma 12, Italia']) {
    it(`«${indirizzo}»: confermata la Via Roma di Piacenza, mai quella di Podenzano`, async () => {
      const s = await cercaNelSelettore(indirizzo);
      expect(
        s.confermate.some((l) => l.lat === PODENZANO.lat && l.lng === PODENZANO.lng),
        'la Via Roma di Podenzano arrivava al modulo confermata',
      ).toBe(false);
      expect(s.ultima).toMatchObject({ address: indirizzo, ...PIACENZA, confermata: true });
      expect(s.testo).toContain('Trovato: Via Roma, Centro Storico, Piacenza');
    });
  }

  it('la città scritta dal negozio resta la sua: «Via Roma 12, Podenzano» cerca a Podenzano', async () => {
    const s = await cercaNelSelettore('Via Roma 12, Podenzano');
    expect(s.ultima).toMatchObject({ ...PODENZANO, confermata: true });
    expect(domandeAlleMappe.every((p) => p.get('city') === 'Podenzano')).toBe(true);
  });

  it('«Via Roma 12 Piacenza», senza virgola: la città c\'è già e non si aggiunge due volte', async () => {
    const s = await cercaNelSelettore('Via Roma 12 Piacenza');
    expect(s.ultima).toMatchObject({ ...PIACENZA, confermata: true });
    expect(domandeAlleMappe.some((p) => /piacenza.*piacenza/i.test(p.toString()))).toBe(false);
  });
});
