/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R01-002 — Nella pagina del reclamo il bottone «Apri reclamo» restava spento senza dire cosa
 * mancava: i messaggi «Seleziona un motivo» e «min 20 caratteri» stanno in `submit`, che col
 * bottone spento non parte mai. Adesso sotto il bottone c'è scritto cosa manca, e il bottone lo
 * dice anche a chi ascolta (aria-describedby). Si monta la pagina vera.
 */

const globali = globalThis as Record<string, unknown>;

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
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
});

/** Il testo che il bottone porta con sé per chi ascolta: quello degli id in aria-describedby. */
function descrizione(el: Element): string {
  const ids = el.getAttribute('aria-describedby');
  if (!ids) return '';
  return ids.split(/\s+/).map((id) => testoVisibile(document.getElementById(id))).filter(Boolean).join(' ');
}

describe('R01-002 — il bottone spento del reclamo dice cosa manca', () => {
  it('senza motivo e senza descrizione, poi col motivo, poi con 20 caratteri', async () => {
    globali.__UTENTE__ = { id: 'u-1', email: 'maria@test.it' };
    globali.__CLIENT_SUPABASE__ = database();
    const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
    const s = accendi(pagina as never, { params: Promise.resolve({ id: 'o-1' }) });
    for (let i = 0; i < 15; i++) await attendi();

    const bottone = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(bottone(), 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();

    // 1. Niente di niente: spento, e dice tutte e due le cose.
    expect(bottone().disabled).toBe(true);
    const prima = descrizione(bottone());
    expect(prima, 'il bottone spento non dice a chi ascolta cosa manca').toMatch(/motivo/i);
    expect(prima).toMatch(/20 caratteri/);
    expect(prima).toMatch(/ne mancano 20/);
    // Ed è scritto anche sullo schermo, non solo per il lettore.
    expect(testoVisibile(document.body)).toMatch(/Per aprire il reclamo: scegli un motivo/);

    // 2. Scelto il motivo: resta solo la descrizione.
    const motivo = document.querySelector('input[name="reason"]') as HTMLInputElement;
    s.agisci(() => motivo.click());
    for (let i = 0; i < 3; i++) await attendi();
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    const scrivi = (testo: string) => s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(area, testo);
      area.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    scrivi('Mai arrivato');
    for (let i = 0; i < 3; i++) await attendi();
    expect(bottone().disabled).toBe(true);
    const dopo = descrizione(bottone());
    expect(dopo).not.toMatch(/motivo/i);
    expect(dopo).toMatch(/ne mancano 8/);

    // 3. Con 20 caratteri il bottone si accende e non c'è più niente da dire.
    scrivi('Mai arrivato a casa!');
    for (let i = 0; i < 3; i++) await attendi();
    expect(bottone().disabled).toBe(false);
    expect(bottone().getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById('reclamo-cosa-manca')).toBeNull();
    s.smonta();
  }, 60000);
});
