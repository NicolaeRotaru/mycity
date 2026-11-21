/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

/**
 * Il modulo di reclamo: dopo il 401 la bozza segue il modulo solo finché la sessione in corso è
 * ancora di chi l'ha scritta (anche quando cambia da un'altra scheda). Si monta QueryProvider vero
 * intorno alla pagina vera; database e rotta del server sono finti.
 */

vi.mock('@/lib/supabase/client', async () => await import('./aiuti/finti/supabase-client.mjs'));

import QueryProvider from '@/components/providers/QueryProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const globali = globalThis as Record<string, unknown>;
type Ascolto = (evento: string, sessione: { user: { id: string } } | null) => void;
const ascolti = () => [...((globali.__ASCOLTI_AUTH__ as Ascolto[] | undefined) ?? [])];

const mondo = { rilascia: null as null | ((stato: number) => void) };

function database() {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order', 'neq', 'insert']) c[m] = () => c;
      const esito = () =>
        tavola === 'orders'
          ? { data: { id: 'o-1', total_price: 20, delivery_status: 'DELIVERED', seller_id: 'pane', created_at: '2026-11-10T10:00:00Z' }, error: null }
          : tavola === 'seller_public_profiles' || tavola === 'profiles'
            ? { data: [{ id: 'pane', store_name: 'Pane Quotidiano' }], error: null }
            : { data: [], error: null };
      c.single = async () => esito();
      c.maybeSingle = c.single;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r);
      return c;
    },
  };
}

const chiave = 'mycity:bozza-reclamo:o-1';
const bozza = () => {
  const grezza = window.sessionStorage.getItem(chiave);
  return grezza === null ? null : (JSON.parse(grezza) as Record<string, unknown>);
};
const TESTO = 'Il pacco non è mai arrivato e il negozio non risponde';
const TESTO_DOPO = 'Il pacco non è mai arrivato, il negozio non risponde e ho pagato la consegna';

let radice: Root | null = null;
let contenitore: HTMLDivElement | null = null;

async function lascia(volte = 15) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function apri() {
  const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
  const params = Promise.resolve({ id: 'o-1' });
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => {
    radice!.render(
      createElement(QueryProvider, null,
        createElement(Suspense, { fallback: null }, createElement(pagina as never, { params }))),
    );
  });
  await lascia();
}

async function avvisa(evento: string, utente: string | null) {
  globali.__UTENTE__ = utente ? { id: utente } : null;
  await act(async () => {
    for (const a of ascolti()) a(evento, utente ? { user: { id: utente } } : null);
  });
  await lascia();
}

async function scrivi(testo: string) {
  const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
  expect(el, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, testo);
    el!.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await lascia(3);
}

/** Motivo, testo, invio; il server risponde 401: la bozza per il rientro è di u1. */
async function inviaE401() {
  const radio = document.querySelector('input[name="reason"][value="not_received"]') as HTMLInputElement | null;
  expect(radio, 'controprova: le scelte del motivo si devono vedere').toBeTruthy();
  await act(async () => radio!.click());
  await scrivi(TESTO);
  const form = document.querySelector('form');
  await act(async () => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await lascia();
  expect(mondo.rilascia, 'controprova: la richiesta al server doveva essere in viaggio').toBeTruthy();
  mondo.rilascia!(401);
  await lascia();
  expect(bozza()?.utente, 'controprova: al 401 la bozza si tiene').toBe('u1');
}

beforeEach(() => {
  window.sessionStorage.clear();
  mondo.rilascia = null;
  globali.__ASCOLTI_AUTH__ = [];
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  vi.stubGlobal('fetch', vi.fn(async () => {
    const stato = await new Promise<number>((r) => { mondo.rilascia = r; });
    return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticazione richiesta' } }), { status: stato });
  }));
});

afterEach(async () => {
  if (radice) await act(async () => radice!.unmount());
  radice = null;
  contenitore?.remove();
  contenitore = null;
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  for (const k of ['__ASCOLTI_AUTH__', '__UTENTE__', '__CLIENT_SUPABASE__']) delete globali[k];
});

describe('il modulo di reclamo: la bozza segue chi ha la sessione', () => {
  it('dopo il 401 entra un altro account: il modulo aperto non riscrive la bozza', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaE401();

    await avvisa('SIGNED_IN', 'u2');
    expect(bozza(), 'controprova: entrato un altro account la bozza si toglie').toBeNull();
    await scrivi(TESTO_DOPO);
    expect(bozza(), 'entrato un altro account, il modulo ha riscritto la bozza').toBeNull();
  }, 60000);

  it('controprova: rientra lo stesso account, la bozza segue il modulo', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaE401();

    await avvisa('SIGNED_IN', 'u1');
    await scrivi(TESTO_DOPO);
    expect(bozza()?.utente).toBe('u1');
    expect(bozza()?.description).toBe(TESTO_DOPO);
  }, 60000);

  it('controprova: sessione sparita senza nessuno che entra, la bozza segue il modulo', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaE401();

    await avvisa('SIGNED_OUT', null);
    await scrivi(TESTO_DOPO);
    expect(bozza()?.description).toBe(TESTO_DOPO);
  }, 60000);
});
