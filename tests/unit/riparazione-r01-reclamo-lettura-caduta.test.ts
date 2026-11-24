/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * SE LA LETTURA DEI RECLAMI CADE, LA PAGINA DEL RECLAMO NON RIPROPONE IL MODULO.
 *
 * Il database tiene un solo reclamo APERTO per ordine (indice unico di migrations/063) e
 * /api/disputes accetta un nuovo reclamo dopo la chiusura del primo: per questo la pagina mostra
 * l'esito del reclamo chiuso sopra il modulo. Se però la lettura dei reclami cadeva, la pagina
 * mostrava il modulo come se non ci fosse niente: con un reclamo già chiuso il cliente ne apriva
 * un secondo senza averne visto l'esito. Adesso una lettura caduta dà l'errore con «Riprova».
 *
 * Si monta la pagina vera; il database è finto e la lettura dei reclami può cadere a comando.
 */

const globali = globalThis as Record<string, unknown>;
const mondo = { reclamiCadono: true, letture: 0 };
const CHIUSO = { status: 'rejected', created_at: '2026-11-12T09:00:00Z', resolution_notes: 'Le foto mostrano la merce integra.', refund_cents: null };

function database() {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order', 'neq']) c[m] = () => c;
      const esito = () => {
        if (tavola === 'orders') {
          return { data: { id: 'o-1', total_price: 20, delivery_status: 'DELIVERED', seller_id: 'pane', created_at: '2026-11-10T10:00:00Z' }, error: null };
        }
        if (tavola === 'seller_public_profiles' || tavola === 'profiles') return { data: [{ id: 'pane', store_name: 'Pane Quotidiano' }], error: null };
        if (tavola === 'disputes') {
          mondo.letture += 1;
          return mondo.reclamiCadono
            ? { data: null, error: { code: '08006', message: 'connection failure' } }
            : { data: [CHIUSO], error: null };
        }
        return { data: [], error: null };
      };
      c.single = async () => esito();
      c.maybeSingle = c.single;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r);
      return c;
    },
  };
}

beforeEach(() => {
  mondo.reclamiCadono = true;
  mondo.letture = 0;
  window.sessionStorage.clear();
  globali.__UTENTE__ = { id: 'u1', email: 'anna@test.it' };
  globali.__CLIENT_SUPABASE__ = database();
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
});

async function apri() {
  const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
  const params = Promise.resolve({ id: 'o-1' });
  const Involucro = () => createElement(Suspense, { fallback: null }, createElement(pagina as never, { params }));
  const s = accendi(Involucro);
  for (let i = 0; i < 15; i++) await attendi();
  return s;
}

const modulo = () => document.querySelector('form');
const avvisoErrore = () => document.querySelector('[role="alert"]');

describe('la pagina del reclamo con la lettura dei reclami caduta', () => {
  it('mostra l’errore con «Riprova» e non il modulo per aprire un reclamo', async () => {
    const s = await apri();
    expect(mondo.letture, 'controprova: la pagina doveva leggere i reclami dell’ordine').toBeGreaterThan(0);
    expect(modulo(), 'con la lettura dei reclami caduta la pagina ripropone il modulo').toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    const avviso = avvisoErrore();
    expect(avviso, 'con la lettura dei reclami caduta la pagina non dice niente').toBeTruthy();
    expect(testoVisibile(avviso)).toMatch(/reclami/i);
    expect(Array.from(document.querySelectorAll('button')).some((b) => /riprova|retry/i.test(testoVisibile(b)))).toBe(true);
    s.smonta();
  }, 60000);

  it('CONTROLLO: con «Riprova» e la lettura riuscita compaiono l’esito del reclamo chiuso e il modulo', async () => {
    const s = await apri();
    expect(modulo(), 'controprova: con la lettura caduta il modulo non c’è').toBeNull();
    mondo.reclamiCadono = false;
    const riprova = Array.from(document.querySelectorAll('button')).find((b) => /riprova|retry/i.test(testoVisibile(b)));
    expect(riprova, 'controprova: il pulsante «Riprova» si deve vedere').toBeTruthy();
    s.agisci(() => clicca(riprova!));
    for (let i = 0; i < 15; i++) await attendi();
    expect(testoVisibile(document.body)).toMatch(/Reclamo respinto/);
    expect(testoVisibile(document.body)).toMatch(/Le foto mostrano la merce integra/);
    expect(modulo(), 'dopo la lettura riuscita il modulo deve tornare').toBeTruthy();
    s.smonta();
  }, 60000);
});
