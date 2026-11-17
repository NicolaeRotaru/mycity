/**
 * @vitest-environment jsdom
 */
/**
 * R02-013 — In navigazione privata o coi dati dei siti bloccati `localStorage` lancia a ogni
 * accesso. La barra in alto (montata su ogni pagina) non deve cadere: qui la si monta coi figli
 * VERI (pillola della posizione, ricerca, categorie, contatori) e con `localStorage` che lancia,
 * in due modi: ogni metodo lancia, oppure lancia già il solo `window.localStorage`.
 *
 * Il difetto stava nella pillola della posizione (lettura del fumetto al montaggio senza try),
 * già chiuso prima di quest'onda: questa prova guarda la barra intera, perché non torni.
 * Solo il database e la navigazione di Next sono finti.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const catena: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte', 'gt', 'lt', 'is', 'or', 'not', 'ilike', 'range', 'maybeSingle', 'single']) catena[m] = () => catena;
  catena.then = (ok: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
  return {
    supabase: {
      auth: {
        // Una sessione che c'è: la barra legge anche il segno delle notifiche spente.
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'u-1' } }), 0);
          return { data: { subscription: { unsubscribe: () => undefined } } };
        },
        getSession: async () => ({ data: { session: { user: { id: 'u-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'u-1' } } }),
        signOut: async () => ({}),
      },
      from: () => catena,
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
    },
  };
});

import Navbar from '@/components/Navbar';

const memoriaVera = Object.getOwnPropertyDescriptor(window, 'localStorage');
let root: Root | null = null;
let radice: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  radice?.remove();
  root = null;
  radice = null;
  if (memoriaVera) Object.defineProperty(window, 'localStorage', memoriaVera);
});

const bloccata = () => new DOMException('The operation is insecure.', 'SecurityError');

async function montaLaBarra() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Se un effetto della barra lancia, React smonta tutto e `act` rilancia l'errore: lo si tiene
  // per dirlo nella prova, invece di lasciarlo scappare.
  let caduta: string | null = null;
  try {
    await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Navbar))); });
    // Gli effetti che partono dopo il montaggio (fumetto della pillola, sessione, contatori).
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  } catch (e) {
    caduta = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return { r: radice, caduta };
}

describe('R02-013 · la barra in alto regge un localStorage che lancia', () => {
  it('ogni metodo di localStorage lancia: la barra si disegna', async () => {
    const rotta = new Proxy({}, { get() { throw bloccata(); } });
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => rotta });
    expect(() => localStorage.getItem('x'), 'controprova: la memoria lancia davvero').toThrow();
    const { r, caduta } = await montaLaBarra();
    expect(caduta, 'la barra è caduta al montaggio').toBeNull();
    expect(r.querySelector('header'), 'la barra è caduta').not.toBeNull();
    expect(r.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('lancia già window.localStorage: la barra si disegna', async () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw bloccata(); } });
    expect(() => window.localStorage, 'controprova: la memoria lancia davvero').toThrow();
    const { r, caduta } = await montaLaBarra();
    expect(caduta, 'la barra è caduta al montaggio').toBeNull();
    expect(r.querySelector('header'), 'la barra è caduta').not.toBeNull();
    expect(r.querySelector('a[href="/"]')).not.toBeNull();
  });
});
