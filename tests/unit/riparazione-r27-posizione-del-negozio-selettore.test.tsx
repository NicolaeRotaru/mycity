/**
 * @vitest-environment jsdom
 */
/**
 * La posizione del negozio poteva finire lontano da Piacenza, o restare quella vecchia, e il
 * modulo la salvava lo stesso.
 *
 * Due buchi nel selettore. ① «Cerca» confermava il primo risultato senza guardare dove fosse:
 * «Via Roma 12» diventava la Via Roma di Roma, con `confermata: true`. ② Cambiato il testo
 * dell'indirizzo, al modulo partivano le coordinate vecchie con `confermata` com'era: chi
 * aggiungeva «, Piacenza» senza ripremere «Cerca» salvava l'altra città.
 *
 * Qui il selettore si MONTA (Leaflet finto, come nella prova gemella del punto di partenza) e si
 * guarda cosa arriva al modulo e cosa legge il negozio.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mappa = vi.hoisted(() => ({ click: null as null | ((e: { latlng: { lat: number; lng: number } }) => void) }));

vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const sempreSe = (base: Record<string, unknown>): Record<string, unknown> => {
    const p: Record<string, unknown> = new Proxy(base, {
      get: (t, k) => (k === 'then' ? undefined : k in t ? t[k as string] : () => p),
    });
    return p;
  };
  const marker = sempreSe({ getLatLng: () => ({ lat: 0, lng: 0 }) });
  const map = sempreSe({
    on: (evento: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => {
      if (evento === 'click') mappa.click = fn;
      return map;
    },
  });
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: () => undefined } },
    map: () => map,
    tileLayer: () => sempreSe({}),
    marker: () => marker,
  };
  return { default: L };
});

import StoreLocationPicker, { type StoreLocation } from '@/components/StoreLocationPicker';

const ROMA = { lat: 41.9009, lng: 12.4833, nome: 'Via Roma, Monti, Roma, Lazio, Italia' };
const PIACENZA = { lat: 45.0497, lng: 9.6985, nome: 'Via Roma, Centro Storico, Piacenza, Emilia-Romagna, Italia' };

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  mappa.click = null;
  vi.unstubAllGlobals();
});

async function apri(defaultValue: Partial<StoreLocation>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onChange = vi.fn<(l: StoreLocation) => void>();
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(StoreLocationPicker, { defaultValue, onChange }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const ultima = () => onChange.mock.calls.at(-1)?.[0] as StoreLocation;
  const campo = radice.querySelector('input[type=text]') as HTMLInputElement;
  return { radice, onChange, ultima, campo };
}

function scrivi(input: HTMLInputElement, valore: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function cerca(radice: HTMLElement, risposta: unknown) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(risposta), { status: 200 }));
  const bottone = [...radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Cerca'));
  expect(bottone, 'bottone Cerca non trovato').toBeTruthy();
  await act(async () => {
    bottone!.click();
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('cambiato il testo, la posizione vecchia non vale più', () => {
  it('una posizione salvata e confermata torna da confermare appena si riscrive l\'indirizzo', async () => {
    const s = await apri({ address: 'Via Emilia Pavese 50', lat: 45.051, lng: 9.695 });
    expect(s.ultima().confermata).toBe(true);
    scrivi(s.campo, 'Via Emilia Pavese 50, Piacenza');
    expect(s.ultima().address).toBe('Via Emilia Pavese 50, Piacenza');
    expect(s.ultima().confermata, 'partivano le coordinate vecchie con confermata=true').toBe(false);
    expect(s.radice.textContent).toContain('premi «Cerca»');
  });

  it('una posizione appena cercata, poi l\'indirizzo corretto senza ripremere «Cerca»: non confermata', async () => {
    const s = await apri({});
    scrivi(s.campo, 'Via Roma 12');
    await cerca(s.radice, PIACENZA);
    expect(s.ultima()).toMatchObject({ lat: PIACENZA.lat, lng: PIACENZA.lng, confermata: true });
    scrivi(s.campo, 'Via Roma 14');
    expect(s.ultima()).toMatchObject({ address: 'Via Roma 14', confermata: false });
  });
});

describe('«Cerca» dice dove è finito e non conferma un posto fuori da Piacenza', () => {
  it('trovata la Via Roma di Roma: niente conferma, un avviso e il nome del posto trovato', async () => {
    const s = await apri({});
    scrivi(s.campo, 'Via Roma 12');
    await cerca(s.radice, ROMA);
    expect(s.onChange.mock.calls.some(([l]) => l.confermata && l.lat === ROMA.lat), 'Roma arrivava al modulo confermata').toBe(false);
    expect(s.ultima().confermata).toBe(false);
    expect(s.radice.textContent).toContain('fuori da Piacenza');
    expect(s.radice.textContent).toContain(ROMA.nome);
  });

  it('trovata la Via Roma di Piacenza: confermata, e il negozio legge dove', async () => {
    const s = await apri({});
    scrivi(s.campo, 'Via Roma 12');
    await cerca(s.radice, PIACENZA);
    expect(s.ultima()).toEqual({ address: 'Via Roma 12', lat: PIACENZA.lat, lng: PIACENZA.lng, confermata: true });
    expect(s.radice.textContent).toContain(`Trovato: ${PIACENZA.nome}`);
    expect(s.radice.textContent).not.toContain('fuori da Piacenza');
  });
});

describe('anche il tocco sulla mappa e il GPS fuori da Piacenza non confermano', () => {
  it('un tocco a Roma non è il negozio', async () => {
    const s = await apri({});
    expect(mappa.click, 'la mappa finta non ha registrato il tocco').toBeTypeOf('function');
    act(() => mappa.click!({ latlng: { lat: ROMA.lat, lng: ROMA.lng } }));
    expect(s.ultima().confermata).toBe(false);
    expect(s.radice.textContent).toContain('fuori da Piacenza');
    act(() => mappa.click!({ latlng: { lat: 45.06, lng: 9.7 } }));
    expect(s.ultima()).toMatchObject({ lat: 45.06, lng: 9.7, confermata: true });
    expect(s.radice.textContent).not.toContain('fuori da Piacenza');
  });

  it('il GPS di chi è a Milano non sposta il negozio', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: 45.4642, longitude: 9.19 } }),
      },
    });
    const s = await apri({});
    const gps = [...s.radice.querySelectorAll('button')].find((b) => b.textContent?.includes('posizione attuale'));
    await act(async () => {
      gps!.click();
    });
    expect(s.onChange.mock.calls.some(([l]) => l.confermata && l.lat === 45.4642)).toBe(false);
    expect(s.radice.textContent).toContain('fuori da Piacenza');
  });
});
