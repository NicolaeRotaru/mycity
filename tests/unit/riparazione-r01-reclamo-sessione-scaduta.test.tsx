/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R01-002 — CON LA SESSIONE SCADUTA IL PULSANTE «APRI RECLAMO» NON FACEVA NIENTE, NON CHIEDEVA DI
 * RIENTRARE E IL TESTO SCRITTO SI PERDEVA.
 *
 * Al 401 di /api/disputes la pagina dice che la sessione è scaduta, con il link all'accesso che
 * torna a questo reclamo, e il pulsante resta usabile. Il testo scritto fino a quel momento resta
 * nella scheda come bozza dell'ordine, anche quello cambiato DOPO il clic mentre il server
 * rispondeva, e la bozza porta il segno `perIlRientro` (il fornitore delle domande la tiene alla
 * sessione scaduta). Al rientro della stessa persona il testo torna nel modulo; un altro account
 * non lo vede; il reclamo partito toglie la bozza.
 *
 * Si monta la pagina vera; il database e la rotta del server sono finti. La rotta può trattenere
 * la risposta finché la prova non la rilascia, per scrivere nel modulo fra il clic e il 401.
 */

const globali = globalThis as Record<string, unknown>;
const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
const mondo = {
  risposte: [] as number[],
  trattieni: false,
  rilascia: null as null | ((stato: number) => void),
};

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

const chiave = (ordine: string) => `mycity:bozza-reclamo:${ordine}`;
const bozza = (ordine = 'o-1') => {
  const grezza = window.sessionStorage.getItem(chiave(ordine));
  return grezza === null ? null : (JSON.parse(grezza) as Record<string, unknown>);
};
const TESTO_A = 'Il pacco non è mai arrivato e il negozio non risponde';
const TESTO_B = 'Il pacco non è mai arrivato, il negozio non risponde e ho pagato la consegna';

beforeEach(() => {
  window.sessionStorage.clear();
  mondo.risposte = [];
  mondo.trattieni = false;
  mondo.rilascia = null;
  globali.__UTENTE__ = { id: 'u1', email: 'anna@test.it' };
  globali.__CLIENT_SUPABASE__ = database();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chiamate.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) });
    let stato = mondo.risposte.shift() ?? 401;
    if (mondo.trattieni) stato = await new Promise<number>((r) => { mondo.rilascia = r; });
    if (stato === 401) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticazione richiesta' } }), { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true, data: { id: 'd-1', status: 'open' } }), { status: 201 });
  }));
});

afterEach(() => {
  document.body.innerHTML = '';
  chiamate.length = 0;
  window.sessionStorage.clear();
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

async function apri(ordine = 'o-1') {
  const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
  const params = Promise.resolve({ id: ordine });
  const Involucro = () => createElement(Suspense, { fallback: null }, createElement(pagina as never, { params }));
  const s = accendi(Involucro);
  for (let i = 0; i < 15; i++) await attendi();
  return s;
}

const area = () => document.querySelector('textarea') as HTMLTextAreaElement | null;
const motivoScelto = () => (document.querySelector('input[name="reason"]:checked') as HTMLInputElement | null)?.value ?? '';
const bottone = () => document.querySelector('button[type="submit"]') as HTMLButtonElement | null;

async function scrivi(s: ReturnType<typeof accendi>, testo: string) {
  const el = area();
  expect(el, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
  s.agisci(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, testo);
    el!.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  for (let i = 0; i < 3; i++) await attendi();
}

async function scegliEScrivi(s: ReturnType<typeof accendi>, motivo: string, testo: string) {
  const radio = document.querySelector(`input[name="reason"][value="${motivo}"]`) as HTMLInputElement | null;
  expect(radio, 'controprova: le scelte del motivo si devono vedere').toBeTruthy();
  s.agisci(() => radio!.click());
  await scrivi(s, testo);
}

async function invia(s: ReturnType<typeof accendi>) {
  const form = document.querySelector('form');
  expect(form, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
  s.agisci(() => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 15; i++) await attendi();
}

async function rilascia(stato: number) {
  expect(mondo.rilascia, 'controprova: la richiesta al server doveva essere in attesa').toBeTruthy();
  mondo.rilascia!(stato);
  for (let i = 0; i < 15; i++) await attendi();
}

/** Clic su «Apri reclamo», poi il testo cambia mentre il server risponde, poi arriva il 401. */
async function scadeDopoIlClic(s: ReturnType<typeof accendi>) {
  await scegliEScrivi(s, 'damaged', TESTO_A);
  mondo.trattieni = true;
  await invia(s);
  await scrivi(s, TESTO_B);
  await rilascia(401);
  mondo.trattieni = false;
  expect(chiamate.at(-1)?.url, 'controprova: il reclamo doveva arrivare alla rotta del server').toBe('/api/disputes');
  expect(chiamate.at(-1)?.corpo.description, 'controprova: al clic è partito il testo di allora').toBe(TESTO_A);
}

describe('R01-002 · con la sessione scaduta il reclamo chiede di rientrare e tiene il testo scritto', () => {
  it('al 401 la pagina chiede di rientrare con il link che torna al reclamo, e il pulsante resta usabile', async () => {
    const s = await apri();
    await scadeDopoIlClic(s);

    const avviso = Array.from(document.querySelectorAll('[role="alert"]')).find((x) => /sessione è scaduta/i.test(x.textContent ?? ''));
    expect(avviso, 'con la sessione scaduta la pagina non chiede di rientrare').toBeTruthy();
    const link = avviso!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/sign-in?returnTo=%2Forders%2Fo-1%2Fdispute');
    expect(testoVisibile(link)).toMatch(/Rientra/);
    expect(bottone()?.disabled, 'dopo il 401 il pulsante resta spento').toBe(false);
    expect(bozza()?.perIlRientro, 'la bozza nata dal 401 non porta il segno per il rientro').toBe(true);
    s.smonta();
  }, 60000);

  it('il testo cambiato dopo il clic è nella bozza, col segno, e al rientro della stessa persona torna nel modulo', async () => {
    const s = await apri();
    await scadeDopoIlClic(s);
    expect(bozza(), 'il testo scritto non è stato tenuto da parte').not.toBeNull();
    expect(bozza()?.description, 'nella bozza c’è il testo del momento del clic, non quello scritto dopo').toBe(TESTO_B);
    expect(bozza()?.utente).toBe('u1');
    expect(bozza()?.perIlRientro, 'la bozza non porta il segno per il rientro').toBe(true);
    s.smonta();

    const dopo = await apri();
    expect(area()?.value, 'al ritorno dall’accesso non c’è il testo scritto per ultimo').toBe(TESTO_B);
    expect(motivoScelto()).toBe('damaged');
    dopo.smonta();
  }, 60000);

  it('un altro account che apre lo stesso reclamo non vede il testo', async () => {
    const s = await apri();
    await scadeDopoIlClic(s);
    expect(bozza()?.perIlRientro, 'controprova: la bozza per il rientro c’è').toBe(true);
    s.smonta();

    globali.__UTENTE__ = { id: 'u2', email: 'bruno@test.it' };
    const altro = await apri();
    expect(area()?.value).toBe('');
    expect(motivoScelto()).toBe('');
    expect(bozza()).toBeNull();
    altro.smonta();
  }, 60000);

  it('il reclamo partito toglie la bozza', async () => {
    const s = await apri();
    await scadeDopoIlClic(s);
    expect(bozza()?.perIlRientro, 'controprova: dopo il 401 la bozza per il rientro c’è').toBe(true);
    mondo.risposte = [201];
    await invia(s);
    expect(chiamate).toHaveLength(2);
    expect(chiamate.at(-1)?.corpo.description, 'il secondo invio manda il testo scritto per ultimo').toBe(TESTO_B);
    expect(bozza(), 'il reclamo è partito ma la bozza resta nella scheda').toBeNull();
    s.smonta();
  }, 60000);
});
