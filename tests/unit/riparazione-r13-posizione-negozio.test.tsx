/**
 * @vitest-environment jsdom
 */
/**
 * R13-006 — La posizione del negozio poteva finire lontano da Piacenza, o restare quella vecchia,
 * e il modulo la salvava lo stesso.
 *
 * Si guardano i tre ingressi nominati nella voce, attraverso i nomi che c'erano già:
 *  ① il selettore (StoreLocationPicker, montato con Leaflet finto): l'indirizzo cambiato non tiene
 *    la posizione vecchia confermata, e un punto trovato fuori Piacenza non si conferma;
 *  ② l'iscrizione (POST /api/seller/apply): una posizione a Roma è un 400 e non si scrive niente;
 *  ③ il profilo del negozio (app/seller/profile/page.tsx): una posizione cambiata fuori Piacenza
 *    non arriva al database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  riga: {} as Record<string, unknown>,
  scritture: [] as Array<Record<string, unknown>>,
  modulo: {} as Record<string, unknown>,
  profilo: {} as Record<string, unknown>,
  errori: [] as string[],
  click: null as null | ((e: { latlng: { lat: number; lng: number } }) => void),
}));

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
    map: () => sempreSe({
      on: (evento: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => {
        if (evento === 'click') stato.click = fn;
        return undefined;
      },
    }),
    tileLayer: () => sempreSe({}),
    marker: () => sempreSe({ getLatLng: () => ({ lat: 0, lng: 0 }) }),
  };
  return { default: L };
});

// ② l'iscrizione: il finto database scrive davvero sulla riga, così si vede se qualcosa è passato.
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'mario@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'consent_log') return { insert: async () => ({ error: null }) };
      let valori: Record<string, unknown> | null = null;
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'or']) c[m] = () => c;
      c.update = (v: Record<string, unknown>) => { valori = v; return c; };
      c.maybeSingle = async () => ({ data: { ...stato.riga }, error: null });
      (c as { then: unknown }).then = (ok: (v: unknown) => void) => {
        if (valori) {
          stato.scritture.push(valori);
          stato.riga = { ...stato.riga, ...valori };
        }
        return ok({ data: [{ id: 'utente-1' }], error: null });
      };
      return c;
    },
  }),
}));

// ③ il profilo: il browser scrive su Supabase; il modulo è sostituito da un bottone che lo invia.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.single = async () => ({ data: { ...stato.profilo }, error: null });
      c.update = (v: Record<string, unknown>) => {
        stato.scritture.push(v);
        return { eq: async () => ({ error: null }) };
      };
      return c;
    },
  },
}));
vi.mock('@/components/VendorForm', () => ({
  default: (p: { onSubmit: (d: Record<string, unknown>) => void }) =>
    createElement('button', { type: 'button', id: 'salva', onClick: () => p.onSubmit(stato.modulo) }, 'Salva'),
}));
vi.mock('@/components/seller/GestisciAbbonamento', () => ({ default: () => null }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));
vi.mock('@/components/seller/DatiPerIBonifici', () => ({ default: () => null }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => null }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => null }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn((m: string) => { stato.errori.push(m); }) },
}));

import StoreLocationPicker, { type StoreLocation } from '@/components/StoreLocationPicker';

const accesi: Root[] = [];
const attendi = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.scritture = [];
  stato.errori = [];
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function monta(elemento: ReturnType<typeof createElement>) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(elemento); });
  await attendi();
  return radice;
}

async function apriSelettore(defaultValue: Partial<StoreLocation>) {
  const onChange = vi.fn<(l: StoreLocation) => void>();
  const radice = await monta(createElement(StoreLocationPicker, { defaultValue, onChange }));
  return { radice, onChange, ultima: () => onChange.mock.calls.at(-1)?.[0] as StoreLocation };
}

function scrivi(input: HTMLInputElement, valore: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function geocodificatore(risposta: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta), { status: 200 })));
}

async function cerca(radice: HTMLElement) {
  const bottone = Array.from(radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Cerca'))!;
  await act(async () => { bottone.click(); });
  await attendi();
}

describe('R13-006 · dal collaudo: il selettore', () => {
  const confermateA = (s: { onChange: { mock: { calls: Array<[StoreLocation]> } } }, lat: number) =>
    s.onChange.mock.calls.map((c) => c[0]).filter((l) => l.confermata && l.lat === lat);

  it('la risposta che arriva dopo un cambio del testo non conferma l\'indirizzo di prima', async () => {
    const s = await apriSelettore({ address: undefined, lat: undefined, lng: undefined });
    const campo = s.radice.querySelector('input[type=text]') as HTMLInputElement;
    scrivi(campo, 'Via Roma 12');
    let rispondi: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((ok) => { rispondi = ok; })));
    const bottone = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Cerca'))!;
    await act(async () => { bottone.click(); });
    scrivi(campo, 'Via Garibaldi 3, Piacenza');
    await act(async () => {
      rispondi(new Response(JSON.stringify({ lat: 45.0505, lng: 9.6905, luogo: 'Via Roma, Piacenza, Italia' }), { status: 200 }));
    });
    await attendi();
    expect(confermateA(s, 45.0505), 'la posizione di Via Roma è arrivata al modulo come confermata').toEqual([]);
    expect(s.ultima()).toMatchObject({ address: 'Via Garibaldi 3, Piacenza', confermata: false });
    expect(s.radice.textContent).toContain('premi di nuovo «Cerca»');
  });

  it('una posizione salvata lontano da Piacenza si apre con un avviso', async () => {
    const s = await apriSelettore({ address: 'Via del Corso 5', lat: 41.91, lng: 12.5 });
    expect(s.radice.querySelector('[role=alert]')?.textContent ?? '').toContain("fuori dall'area di Piacenza");
    // Resta confermata di proposito: il profilo e il database lasciano passare quella che non cambia.
    expect(s.ultima().confermata).toBe(true);
    const dentro = await apriSelettore({ address: 'Via Cavour 3', lat: 45.051, lng: 9.695 });
    expect(dentro.radice.querySelector('[role=alert]')).toBeNull();
  });

  it('il GPS a Milano non conferma la posizione, e lo dice subito', async () => {
    const s = await apriSelettore({ address: 'Via Cavour 3', lat: 45.051, lng: 9.695 });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 45.4642, longitude: 9.19 } }) },
    });
    try {
      const gps = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent?.includes('posizione attuale'))!;
      await act(async () => { gps.click(); });
      await attendi();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).geolocation;
    }
    expect(confermateA(s, 45.4642), 'il punto di Milano è arrivato al modulo come confermato').toEqual([]);
    expect(s.ultima()).toMatchObject({ lat: 45.4642, confermata: false });
    expect(s.radice.querySelector('[role=alert]')?.textContent ?? '').toContain('Piacenza');
  });

  it('il tocco sulla mappa fuori area non conferma; un tocco dentro conferma e toglie l\'avviso', async () => {
    const s = await apriSelettore({ address: 'Via del Corso 5', lat: 41.91, lng: 12.5 });
    expect(stato.click, 'la mappa finta non ha registrato il tocco').toBeTypeOf('function');
    act(() => stato.click!({ latlng: { lat: 45.4642, lng: 9.19 } }));
    expect(s.ultima()).toMatchObject({ lat: 45.4642, confermata: false });
    expect(s.radice.querySelector('[role=alert]')?.textContent ?? '').toContain('Piacenza');
    act(() => stato.click!({ latlng: { lat: 45.06, lng: 9.7 } }));
    expect(s.ultima()).toEqual({ address: 'Via del Corso 5', lat: 45.06, lng: 9.7, confermata: true });
    expect(s.radice.querySelector('[role=alert]')).toBeNull();
  });
});

describe('R13-006 ① il selettore della posizione', () => {
  it('cambiare l\'indirizzo toglie la conferma alla posizione vecchia', async () => {
    const s = await apriSelettore({ address: 'Via Roma 12', lat: 45.051, lng: 9.695 });
    expect(s.ultima().confermata).toBe(true);
    scrivi(s.radice.querySelector('input[type=text]') as HTMLInputElement, 'Via Roma 12, Piacenza');
    expect(s.ultima().address).toBe('Via Roma 12, Piacenza');
    expect(s.ultima().confermata, 'testo nuovo con le coordinate vecchie, confermate').toBe(false);
  });

  it('un punto trovato a Roma non si conferma, e si dice dov\'è finito', async () => {
    const s = await apriSelettore({ address: undefined, lat: undefined, lng: undefined });
    scrivi(s.radice.querySelector('input[type=text]') as HTMLInputElement, 'Via Roma 12');
    geocodificatore({ lat: 41.9, lng: 12.49, luogo: 'Via Roma, Roma, Lazio, Italia' });
    await cerca(s.radice);
    const confermate = s.onChange.mock.calls.map((c) => c[0]).filter((l) => l.confermata);
    expect(confermate, 'il punto di Roma è arrivato al modulo come confermato').toEqual([]);
    expect(s.radice.querySelector('[role=alert]')?.textContent ?? '').toContain('Roma');
  });

  it('un punto a Piacenza si conferma e si legge dove è stato trovato', async () => {
    const s = await apriSelettore({ address: undefined, lat: undefined, lng: undefined });
    scrivi(s.radice.querySelector('input[type=text]') as HTMLInputElement, 'Via Roma 12, Piacenza');
    geocodificatore({ lat: 45.0505, lng: 9.6905, luogo: 'Via Roma, Piacenza, Emilia-Romagna, Italia' });
    await cerca(s.radice);
    expect(s.ultima()).toEqual({ address: 'Via Roma 12, Piacenza', lat: 45.0505, lng: 9.6905, confermata: true });
    expect(s.radice.textContent).toContain('Trovato: Via Roma, Piacenza');
  });
});

const domanda = {
  contactPhone: '3331234567', legalFirstName: 'Mario', legalLastName: 'Rossi', legalFiscalCode: 'RSSMRA80E05G535X',
  legalBirthDate: '1980-05-05', legalResidenceAddr: 'Via Roma 1', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
  businessLegalName: 'Salumeria Rossi', businessVatNumber: '01234567897', businessAddress: 'Via Roma 1',
  businessCity: 'Piacenza', businessZip: '29121', storeName: 'Salumeria Rossi', storeDescription: '', billingIban: '',
  storeLogo: null, storeMedia: [], storeAddress: 'Via Roma 12', storeLat: 45.05, storeLng: 9.69,
  acceptTos: true, acceptPrivacy: true, acceptAccuracy: true, acceptBilling: true,
};

async function iscrivi(corpo: Record<string, unknown>) {
  const { POST } = await import('@/app/api/seller/apply/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );
}

describe('R13-006 ② l\'iscrizione del negozio', () => {
  beforeEach(() => {
    stato.riga = { id: 'utente-1', role: 'buyer', approval_status: null, approval_requested_at: null };
  });

  it('una posizione a Roma è rifiutata e non si scrive niente', async () => {
    const res = await iscrivi({ ...domanda, storeLat: 41.9, storeLng: 12.49 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Piacenza');
    expect(stato.scritture).toEqual([]);
  });

  it('una posizione a Piacenza passa come prima', async () => {
    const res = await iscrivi(domanda);
    expect(res.status).toBe(200);
    expect(stato.riga.store_lat).toBe(45.05);
  });
});

describe('R13-006 ③ il profilo del negozio', () => {
  async function salva(storeLat: number, storeLng: number) {
    stato.profilo = { id: 'negozio-1', store_lat: 45.051, store_lng: 9.695, store_address: 'Via Cavour 3' };
    stato.modulo = { storePhone: '3331234567', storeAddress: 'Via Roma 12', storeLat, storeLng, storeHours: {} };
    const { default: Pagina } = await import('@/app/seller/profile/page');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const radice = await monta(createElement(QueryClientProvider, { client: qc }, createElement(Pagina)));
    await attendi(50);
    const bottone = radice.querySelector('#salva') as HTMLButtonElement;
    expect(bottone, 'la pagina non ha mostrato il modulo').toBeTruthy();
    await act(async () => { bottone.click(); });
    await attendi(50);
  }

  it('una posizione cambiata a Roma non arriva al database, e il negozio legge perché', async () => {
    await salva(41.9, 12.49);
    expect(stato.scritture).toEqual([]);
    expect(stato.errori.join(' ')).toContain('Piacenza');
  });

  it('una posizione dentro Piacenza si salva come prima', async () => {
    await salva(45.0515, 9.6942);
    expect(stato.scritture).toHaveLength(1);
    expect(stato.scritture[0]).toMatchObject({ store_lat: 45.0515, store_lng: 9.6942 });
  });
});
