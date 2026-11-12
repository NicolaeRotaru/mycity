/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R03-013 (parte della pagina) — «Apri un reclamo» passa dalla rotta /api/disputes, che avvisa
 * amministratori e negozio, e non scrive più la riga dal browser. E non promette tempi
 * («entro pochi minuti», «entro 48h») che nessuno era stato avvisato di dover rispettare.
 */

const globali = globalThis as Record<string, unknown>;
const inserimenti: Array<{ tavola: string; valori: unknown }> = [];
const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];

function database() {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order', 'neq']) c[m] = () => c;
      c.insert = (valori: unknown) => { inserimenti.push({ tavola, valori }); return c; };
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
  inserimenti.length = 0;
  chiamate.length = 0;
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

describe('R03-013 — la pagina del reclamo passa dal server', () => {
  it('«Invia» chiama /api/disputes e non scrive in disputes dal browser; niente «entro 48h»', async () => {
    globali.__UTENTE__ = { id: 'u-1', email: 'maria@test.it' };
    globali.__CLIENT_SUPABASE__ = database();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      chiamate.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, data: { id: 'd-1', status: 'open' } }), { status: 201 });
    }));
    const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
    const s = accendi(pagina as never, { params: Promise.resolve({ id: 'o-1' }) });
    for (let i = 0; i < 15; i++) await attendi();
    expect(testoVisibile(document.body)).not.toMatch(/entro pochi minuti|Decisione entro 48h/);
    const motivo = document.querySelector('input[name="reason"]') as HTMLInputElement;
    expect(motivo, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
    s.agisci(() => motivo.click());
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Il fattorino non è mai passato e non ho ricevuto niente');
      area.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 5; i++) await attendi();
    const form = document.querySelector('form')!;
    s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    for (let i = 0; i < 15; i++) await attendi();
    expect(inserimenti.filter((x) => x.tavola === 'disputes'), 'la riga si scrive ancora dal browser, e nessuno viene avvisato').toHaveLength(0);
    expect(chiamate.find((c) => c.url === '/api/disputes')?.corpo).toMatchObject({ orderId: 'o-1' });
    s.smonta();
  }, 60000);
});
