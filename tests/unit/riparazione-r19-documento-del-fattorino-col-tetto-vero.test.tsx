/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R19-002 — un documento del fattorino fra 4,4 e 8 MB veniva rifiutato dalla
 * piattaforma (413 in testo semplice, prima della rotta) e la pagina mostrava
 * «Unexpected token 'R'… is not valid JSON», mentre prometteva «max 8 MB».
 *
 * Si monta la pagina vera; il finto è solo supabase, i messaggi (sonner) e la
 * rete. Il fattorino ha già salvato la data di nascita, quindi i caricamenti
 * sono aperti.
 */

const errori: string[] = [];
const riusciti: string[] = [];

vi.mock('next/navigation', () => {
  // Lo stesso oggetto a ogni disegno, come il router vero: la pagina lo tiene
  // fra le dipendenze del suo effetto.
  const router = { replace: () => undefined, push: () => undefined };
  return { useRouter: () => router };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => { errori.push(String(m)); },
    success: (m: string) => { riusciti.push(String(m)); },
    info: () => undefined,
    warning: () => undefined,
  },
}));
vi.mock('@/lib/supabase/client', () => {
  const profilo = { id: 'f1', role: 'rider', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_birth_date: '1990-01-01', rider_vehicle_type: 'BIKE' };
  const catena: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update']) catena[m] = () => catena;
  catena.single = async () => ({ data: profilo, error: null });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'f1', email: 'f@test.it' } } }),
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => catena,
    },
  };
});

const { default: Pagina } = await import('@/app/rider/onboarding/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let radice: HTMLElement;
let root: Root;
const chiamate: string[] = [];

async function lascia() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function monta() {
  radice = document.createElement('div');
  document.body.appendChild(radice);
  await act(async () => {
    root = createRoot(radice);
    root.render(createElement(Pagina));
  });
  await lascia();
}

/** Sceglie un file per il fronte del documento, come fa il fattorino. */
async function scegli(mb: number) {
  const input = radice.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input, 'manca il campo del documento').not.toBeNull();
  expect(input!.disabled, 'i caricamenti dovrebbero essere aperti').toBe(false);
  const file = new File([new Uint8Array(Math.round(mb * 1024 * 1024))], 'carta.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input!, 'files', { value: [file], configurable: true });
  await act(async () => { input!.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await lascia();
}

beforeEach(() => {
  errori.length = 0;
  riusciti.length = 0;
  chiamate.length = 0;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => { root.unmount(); });
  radice.remove();
});

describe('R19-002 · il documento del fattorino ha il tetto vero, detto in italiano', () => {
  it('la pagina promette il tetto che arriva davvero, non 8 MB', async () => {
    await monta();
    const testo = radice.textContent ?? '';
    expect(testo).not.toMatch(/8\s?MB/);
    expect(testo).toMatch(/max 4 MB/);
  });

  it('un file da 5 MB si ferma prima di partire, con un messaggio in italiano', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      chiamate.push(String(u));
      return new Response('Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE', { status: 413, headers: { 'content-type': 'text/plain' } });
    }));
    await monta();
    await scegli(5);
    expect(chiamate.filter((u) => u.includes('/api/kyc/upload-document'))).toEqual([]);
    expect(errori.join(' | ')).toMatch(/File troppo grande, massimo 4 MB/);
  });

  it('se la piattaforma risponde 413 in testo semplice, niente «is not valid JSON»: si dice che il file è troppo grande', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      chiamate.push(String(u));
      return new Response('Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE', { status: 413, headers: { 'content-type': 'text/plain' } });
    }));
    await monta();
    await scegli(3);
    expect(chiamate.some((u) => u.includes('/api/kyc/upload-document'))).toBe(true);
    const detto = errori.join(' | ');
    expect(detto).not.toMatch(/JSON|Unexpected token/);
    expect(detto).toMatch(/File troppo grande, massimo 4 MB/);
  });

  it('un file da 3 MB accettato dalla rotta si carica come prima', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      chiamate.push(String(u));
      return new Response(JSON.stringify({ url: 'https://firmato/x', path: 'f1/id_front-1.jpg', kind: 'id_front' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await monta();
    await scegli(3);
    expect(errori).toEqual([]);
    expect(riusciti.join(' | ')).toMatch(/caricato/);
  });
});
