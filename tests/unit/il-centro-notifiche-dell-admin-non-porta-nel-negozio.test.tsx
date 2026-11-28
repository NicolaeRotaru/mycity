/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — IL CENTRO NOTIFICHE APERTO DALL'ADMIN NON PORTA NELL'AREA NEGOZIO.
 *
 * È l'altra strada per aprire una notifica: «Vedi tutte nel Centro notifiche», o la campanella della barra in alto
 * (components/Navbar.tsx) che porta a /notifications. Il collaudo ha tolto la regola da qui e le prove della
 * campanella restavano verdi: questa diventa rossa. Scritta dal collaudatore, entrata col lavoro.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const righe = [
  { id: 'n1', user_id: 'u1', title: 'Ordine di servizio per SDG: Movida Cafè', body: null, link: '/seller/ordini-sdg', is_read: false, category: 'system', created_at: new Date(Date.now() - 60000).toISOString() },
  { id: 'n2', user_id: 'u1', title: 'Nuovo ordine #7', body: null, link: '/seller/orders/7?x=1#s', is_read: true, category: 'order', created_at: new Date(Date.now() - 120000).toISOString() },
  { id: 'n3', user_id: 'u1', title: 'Richiesta assistenza', body: null, link: '/messages/4c', is_read: true, category: 'system', created_at: new Date(Date.now() - 180000).toISOString() },
];
function database() {
  return {
    from: () => {
      const filtri: Record<string, unknown> = {};
      let conta = false; let limite = Infinity;
      const c: Record<string, unknown> = {};
      c.select = (_c: string, o?: { head?: boolean }) => { conta = !!o?.head; return c; };
      c.eq = (k: string, v: unknown) => { filtri[k] = v; return c; };
      c.neq = () => c; c.not = () => c; c.in = () => c; c.lt = () => c; c.order = () => c; c.range = () => c;
      c.limit = (n: number) => { limite = n; return c; };
      c.maybeSingle = async () => ({ data: { notif_promos: true, notif_newsletter: true }, error: null });
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const scelte = righe.filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        return Promise.resolve(conta ? { data: null, count: scelte.length, error: null } : { data: scelte.slice(0, limite), error: null }).then(ok, ko);
      };
      return c;
    },
  };
}
async function lascia() { for (let i = 0; i < 30; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

beforeEach(() => { globali.__UTENTE__ = { id: 'u1' }; globali.__CLIENT_SUPABASE__ = database(); globali.__ASCOLTI_AUTH__ = []; });
afterEach(() => { document.body.innerHTML = ''; for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PROFILO__']) delete globali[k]; });

async function apri() {
  const mod = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(mod.default as never)));
  await lascia();
  return s;
}
const hrefDi = (r: HTMLElement, t: string) => Array.from(r.querySelectorAll('a')).find((a) => a.textContent?.includes(t))?.getAttribute('href') ?? null;

describe('Centro notifiche', () => {
  it("aperto dall'admin, nessuna voce porta nell'area negozio", async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isAdmin: true, profile: { id: 'u1', role: 'admin' } };
    const s = await apri();
    expect(hrefDi(s.radice, 'Ordine di servizio')).toBe('/admin/ordini-sdg');
    expect(hrefDi(s.radice, 'Nuovo ordine')).toBe('/admin/orders/7');
    expect(hrefDi(s.radice, 'Richiesta')).toBe('/messages/4c');
    s.smonta();
  });
  it('aperto dal negozio, i link restano com’erano', async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isSeller: true, profile: { id: 'u1', role: 'seller' } };
    const s = await apri();
    expect(hrefDi(s.radice, 'Ordine di servizio')).toBe('/seller/ordini-sdg');
    expect(hrefDi(s.radice, 'Nuovo ordine')).toBe('/seller/orders/7?x=1#s');
    s.smonta();
  });
});
