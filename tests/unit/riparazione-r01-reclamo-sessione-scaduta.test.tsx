/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, Suspense, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R01-012 — Con la sessione scaduta «Apri reclamo» non chiedeva di rientrare e il testo scritto
 * si perdeva. Il server risponde 401 (/api/disputes, `withAuthRateLimit`): la pagina deve dire
 * «la sessione è scaduta, rientra» con il link all'accesso che torna al reclamo, e al ritorno il
 * motivo e il testo devono essere ancora lì. Si monta la pagina vera due volte: prima e dopo
 * l'accesso, con la stessa memoria della scheda.
 */

const globali = globalThis as Record<string, unknown>;
const TESTO = 'Il fattorino non è mai passato e non ho ricevuto niente';

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

afterEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

async function apri() {
  const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default as ComponentType<Record<string, unknown>>;
  // Con un confine di Suspense: la pagina si rimonta due volte e `use(params)` sospende a ogni montaggio.
  const ConSospensione = (p: Record<string, unknown>) => createElement(Suspense, { fallback: null }, createElement(pagina, p));
  const s = accendi(ConSospensione, { params: Promise.resolve({ id: 'o-1' }) });
  for (let i = 0; i < 15; i++) await attendi();
  return s;
}

describe('R01-012 — sessione scaduta sul reclamo: si dice di rientrare e il testo resta', () => {
  it('401 dal server → «rientra» col ritorno al reclamo; riaperta la pagina, motivo e testo ci sono', async () => {
    globali.__UTENTE__ = { id: 'u-1', email: 'maria@test.it' };
    globali.__CLIENT_SUPABASE__ = database();
    const chiamate: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chiamate.push(String(url));
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Autenticazione richiesta' } }), { status: 401 });
    }));

    const s = await apri();
    const motivi = Array.from(document.querySelectorAll('input[name="reason"]')) as HTMLInputElement[];
    expect(motivi.length, 'controprova: il modulo del reclamo si deve vedere').toBeGreaterThan(2);
    s.agisci(() => motivi[1].click()); // «Arrivato danneggiato»
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, TESTO);
      area.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 5; i++) await attendi();
    const form = document.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    for (let i = 0; i < 15; i++) await attendi();
    expect(chiamate).toContain('/api/disputes');

    // 1. Lo dice, a parole, e porta all'accesso che torna qui.
    const avviso = document.querySelector('[role="alert"]');
    expect(testoVisibile(avviso), 'con la sessione scaduta la pagina non dice di rientrare').toMatch(/sessione è scaduta/i);
    const link = Array.from(document.querySelectorAll('a[href]')).find((a) => a.getAttribute('href')!.startsWith('/sign-in'));
    expect(link, 'manca il link per rientrare').toBeTruthy();
    const ritorno = new URL(link!.getAttribute('href')!, 'https://mycity.test').searchParams.get('returnTo');
    expect(ritorno).toBe('/orders/o-1/dispute');
    // Il modulo aperto non si svuota.
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(TESTO);
    s.smonta();
    document.body.innerHTML = '';

    // 2. Di ritorno dall'accesso (pagina rimontata, stessa scheda): motivo e testo ci sono ancora.
    const s2 = await apri();
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value, 'al ritorno il testo scritto si è perso').toBe(TESTO);
    const scelto = document.querySelector('input[name="reason"]:checked') as HTMLInputElement | null;
    expect(scelto?.value).toBe('damaged');
    s2.smonta();
  }, 60000);

  it('un reclamo aperto davvero non lascia la bozza in giro', async () => {
    globali.__UTENTE__ = { id: 'u-1', email: 'maria@test.it' };
    globali.__CLIENT_SUPABASE__ = database();
    window.sessionStorage.setItem('mycity:bozza-reclamo:o-1', JSON.stringify({ reason: 'damaged', description: TESTO }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { id: 'd-1', status: 'open' } }), { status: 201 })));
    const s = await apri();
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(TESTO);
    const form = document.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    for (let i = 0; i < 15; i++) await attendi();
    expect(window.sessionStorage.getItem('mycity:bozza-reclamo:o-1')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    s.smonta();
  }, 60000);
});
