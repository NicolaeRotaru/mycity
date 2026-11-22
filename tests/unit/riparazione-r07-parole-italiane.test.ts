/**
 * @vitest-environment jsdom
 */
/**
 * R07-006 — Parole inglesi e da programmatore nell'interfaccia: «Rating minimo» e «Rating 4+» nei
 * filtri di ricerca e categoria (la voce chiede «Voto minimo» e «Voto 4+», come il resto del sito),
 * «id_front caricato» al fattorino che carica il documento, e nella stessa pagina «Upload fallito»,
 * «Errore upload», «KYC approvato!», l'errore del GPS del negozio col testo inglese del browser
 * («User denied Geolocation»), «Catalog Copilot».
 *
 * Qui i componenti VERI montati in jsdom, e si guarda cosa legge la persona.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta, testoVisibile } from './aiuti/monta-componente';

const avvisi = vi.hoisted(() => ({ riusciti: [] as string[], errori: [] as string[] }));
/** Il profilo del fattorino che legge la pagina dei documenti; una prova può aggiungere i documenti già caricati. */
const fattorino = vi.hoisted(() => {
  const base = { id: 'f1', role: 'rider', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_birth_date: '1990-01-01', rider_vehicle_type: 'BIKE' };
  return { base, profilo: { ...base } as Record<string, unknown> };
});

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: (m: string) => { avvisi.riusciti.push(String(m)); },
    error: (m: string) => { avvisi.errori.push(String(m)); },
    info: () => undefined,
    warning: () => undefined,
    loading: () => 'avviso',
    dismiss: () => undefined,
  }),
  Toaster: () => null,
}));
vi.mock('next/navigation', () => {
  const router = { replace: () => undefined, push: () => undefined, refresh: () => undefined };
  return { useRouter: () => router, usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/supabase/client', () => {
  const catena: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update']) catena[m] = () => catena;
  catena.single = async () => ({ data: fattorino.profilo, error: null });
  catena.maybeSingle = async () => ({ data: fattorino.profilo, error: null });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'f1', email: 'f@test.it' } } }),
        getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'f1' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => catena,
    },
  };
});
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

const g = globalThis as Record<string, unknown>;
const accesi: Array<{ root: Root; radice: HTMLElement }> = [];

afterEach(async () => {
  for (const { root, radice } of accesi.splice(0)) {
    await act(async () => { root.unmount(); });
    radice.remove();
  }
  avvisi.riusciti.length = 0;
  avvisi.errori.length = 0;
  fattorino.profilo = { ...fattorino.base };
  vi.unstubAllGlobals();
  delete g.__QUERY_FINTA__;
  delete g.__PERCORSO_FINTO__;
  delete g.__DATI_QUERY__;
});

async function lascia() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function accendi(componente: unknown, proprieta: Record<string, unknown> = {}) {
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push({ root, radice });
  await act(async () => { root.render(createElement(componente as never, proprieta)); });
  await lascia();
  return radice;
}

describe('R07-006 · filtri: «Voto minimo», non «Rating»', () => {
  it('ricerca: il filtro e il chip attivo dicono «Voto», come il resto del sito', async () => {
    g.__PERCORSO_FINTO__ = '/search';
    g.__QUERY_FINTA__ = 'q=pane&stelle=4';
    const mod = await monta('app/search/page.tsx');
    const testo = testoVisibile(await accendi(mod.default));
    expect(testo).toContain('Voto minimo');
    // Il next-intl finto delle prove non sostituisce {rating}: il chip esce col segnaposto.
    expect(testo).toMatch(/Voto (4|\{rating\})\+/);
    expect(testo).not.toMatch(/\bRating\b/);
    expect(testo).not.toMatch(/Valutazione (minima|4\+|\{rating\})/);
  }, 60000);

  it('categoria: il filtro dice «Voto minimo»', async () => {
    g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) =>
      o.queryKey[0] === 'category'
        ? { category: { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null }, madre: null, subcategories: [] }
        : undefined;
    const mod = await monta('app/category/[slug]/page.tsx');
    const testo = testoVisibile(await accendi(mod.default, { params: { slug: 'alimentari' } }));
    expect(testo).toContain('Voto minimo');
    expect(testo).not.toMatch(/\bRating\b/);
    expect(testo).not.toContain('Valutazione minima');
  }, 60000);
});

describe('R07-006 · il fattorino che carica un documento legge un messaggio in italiano', () => {
  it('dopo il fronte del documento: «Documento d’identità (fronte) caricato», non «id_front caricato»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'https://esempio.it/doc.jpg' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const { default: Pagina } = await import('@/app/rider/onboarding/page');
    const radice = await accendi(Pagina);
    const input = radice.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input, 'manca il campo del documento').not.toBeNull();
    const file = new File([new Uint8Array(1024)], 'carta.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    await act(async () => { input!.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await lascia();

    expect(avvisi.errori).toEqual([]);
    expect(avvisi.riusciti).toEqual(['Documento d’identità (fronte) caricato']);
  });

  /** Sceglie un file nel primo campo «documento» della pagina e aspetta la risposta. */
  async function caricaIlFronte(radice: HTMLElement) {
    const input = radice.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input, 'manca il campo del documento').not.toBeNull();
    const file = new File([new Uint8Array(1024)], 'carta.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    await act(async () => { input!.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await lascia();
  }

  it('caricamento rifiutato senza spiegazione: «Caricamento non riuscito», non «Upload fallito»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })));
    const { default: Pagina } = await import('@/app/rider/onboarding/page');
    await caricaIlFronte(await accendi(Pagina));
    expect(avvisi.riusciti).toEqual([]);
    expect(avvisi.errori).toEqual(['Caricamento non riuscito']);
  });

  it('caricamento caduto per strada: «Errore nel caricamento», non «Errore upload»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'rete assente'; }));
    const { default: Pagina } = await import('@/app/rider/onboarding/page');
    await caricaIlFronte(await accendi(Pagina));
    expect(avvisi.riusciti).toEqual([]);
    expect(avvisi.errori).toEqual(['Errore nel caricamento']);
  });

  /** Documenti obbligatori della bici già caricati: si preme «salva e avvia» con la risposta data. */
  async function avviaLaVerifica(risposta: { status: number; body: unknown }) {
    fattorino.profilo = { ...fattorino.base, kyc_id_doc_front_url: 'f1/fronte.jpg', kyc_selfie_url: 'f1/selfie.jpg' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta.body), { status: risposta.status, headers: { 'content-type': 'application/json' } })));
    const { default: Pagina } = await import('@/app/rider/onboarding/page');
    const radice = await accendi(Pagina);
    const pulsante = Array.from(radice.querySelectorAll('button')).find((b) => b.textContent === 'saveAndStart');
    expect(pulsante, 'manca il pulsante che avvia la verifica').toBeDefined();
    expect(pulsante!.disabled, 'con i documenti obbligatori caricati il pulsante deve essere attivo').toBe(false);
    await act(async () => { pulsante!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await lascia();
    return [...avvisi.riusciti, ...avvisi.errori];
  }

  it('verifica approvata subito: «Documenti approvati!», non «KYC approvato!»', async () => {
    expect(await avviaLaVerifica({ status: 200, body: { status: 'APPROVED' } })).toEqual(['Documenti approvati!']);
  });

  it('verifica in corso: «Documenti inviati: li stiamo verificando», non «KYC inviato»', async () => {
    expect(await avviaLaVerifica({ status: 200, body: { status: 'PENDING' } })).toEqual(['Documenti inviati: li stiamo verificando']);
  });

  it('verifica che non parte: nessun avviso con la sigla «KYC»', async () => {
    const letti = await avviaLaVerifica({ status: 500, body: {} });
    expect(letti).toHaveLength(1);
    expect(letti[0]).not.toMatch(/KYC/);
  });

  it('la pagina dei documenti parla italiano: niente «Onboarding», «se food», «face match», «account rider»', async () => {
    const { default: Pagina } = await import('@/app/rider/onboarding/page');
    const testo = testoVisibile(await accendi(Pagina));
    expect(testo).toContain('Documenti e verifica');
    expect(testo).toContain('Attestato HACCP');
    expect(testo).not.toMatch(/onboarding/i);
    expect(testo).not.toContain('se food');
    expect(testo).not.toContain('face match');
    expect(testo).not.toContain('account rider');
  });
});

describe('R07-006 · il GPS del negozio sbaglia in italiano', () => {
  async function erroreDelGps(code: number, message: string) {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (_ok: unknown, ko: (e: { code: number; message: string }) => void) => ko({ code, message }),
      },
    });
    const { default: StoreLocationPicker } = await import('@/components/StoreLocationPicker');
    const radice = await accendi(StoreLocationPicker, { defaultValue: {}, onChange: () => undefined });
    const pulsante = Array.from(radice.querySelectorAll('button')).find((b) => /mia posizione/i.test(b.textContent ?? ''));
    expect(pulsante, 'manca «Usa la mia posizione attuale»').toBeDefined();
    await act(async () => { pulsante!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await lascia();
    return testoVisibile(radice);
  }

  it('permesso negato: niente «User denied Geolocation», si dice cosa fare', async () => {
    const testo = await erroreDelGps(1, 'User denied Geolocation');
    expect(testo).not.toContain('User denied');
    expect(testo).toContain('Il browser non dà il permesso di usare la posizione');
  });

  it('tempo scaduto: niente «Timeout expired», un messaggio in italiano', async () => {
    const testo = await erroreDelGps(3, 'Timeout expired');
    expect(testo).not.toContain('Timeout expired');
    expect(testo).toContain('Impossibile ottenere la posizione in questo momento');
  });
});

describe('R07-006 · il Copilot del catalogo si presenta in italiano', () => {
  it('il titolo è «Copilot del catalogo», non «Catalog Copilot»', async () => {
    const { default: CatalogCopilot } = await import('@/components/seller/CatalogCopilot');
    const testo = testoVisibile(await accendi(CatalogCopilot));
    expect(testo).toContain('Copilot del catalogo');
    expect(testo).not.toContain('Catalog Copilot');
  });
});
