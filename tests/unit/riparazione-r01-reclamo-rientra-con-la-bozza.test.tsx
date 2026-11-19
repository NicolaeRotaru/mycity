/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R01-003 — CON LA SESSIONE SCADUTA IL PULSANTE «APRI RECLAMO» NON FACEVA NIENTE, NON CHIEDEVA DI
 * RIENTRARE E IL TESTO SCRITTO SI PERDEVA.
 *
 * Con la sessione scaduta /api/disputes risponde 401. Adesso la pagina lo dice con il link
 * all'accesso che torna al reclamo, il pulsante si può premere di nuovo, e motivo e testo restano
 * in questa scheda come bozza dell'ordine: al ritorno tornano nel modulo. La bozza si cancella
 * quando il reclamo parte, e non vale per un altro ordine.
 *
 * Seconda passata (collaudo): la bozza tornata nel modulo si cancella subito, così un testo
 * cambiato o svuotato dopo il ritorno non viene sostituito dalla bozza vecchia alla visita dopo;
 * e si cancella anche quando c'è già un reclamo aperto. La bozza riprende il testo solo per chi
 * l'ha scritto.
 *
 * Si monta la pagina vera; il database e la rotta del server sono finti.
 */

const globali = globalThis as Record<string, unknown>;
const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
const mondo = {
  aperti: [] as Array<{ created_at: string; status: string }>,
  risposte: [] as number[],
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
            : tavola === 'disputes'
              ? { data: mondo.aperti, error: null }
              : { data: [], error: null };
      c.single = async () => esito();
      c.maybeSingle = c.single;
      c.then = (r: (v: unknown) => unknown) => Promise.resolve(esito()).then(r);
      return c;
    },
  };
}

const chiave = (ordine: string) => `mycity:bozza-reclamo:${ordine}`;
const TESTO_A = 'Il pacco non è mai arrivato e il negozio non risponde';
const TESTO_B = 'Ho riletto: il pacco è arrivato ma era tutto rotto dentro';

beforeEach(() => {
  window.sessionStorage.clear();
  mondo.aperti = [];
  mondo.risposte = [];
  globali.__UTENTE__ = { id: 'u-anna', email: 'anna@test.it' };
  globali.__CLIENT_SUPABASE__ = database();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chiamate.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) });
    const stato = mondo.risposte.shift() ?? 401;
    // 0: la rete cade e la richiesta non arriva.
    if (stato === 0) throw new TypeError('fetch failed');
    if (stato === 401) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticazione richiesta' } }), { status: 401 });
    }
    if (stato >= 400) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: 'Errore del server' } }), { status: stato });
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

function scrivi(s: ReturnType<typeof accendi>, testo: string) {
  const el = area();
  expect(el, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
  s.agisci(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, testo);
    el!.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function scegliEScrivi(s: ReturnType<typeof accendi>, motivo: string, testo: string) {
  const radio = document.querySelector(`input[name="reason"][value="${motivo}"]`) as HTMLInputElement | null;
  expect(radio, 'controprova: le scelte del motivo si devono vedere').toBeTruthy();
  s.agisci(() => radio!.click());
  scrivi(s, testo);
  for (let i = 0; i < 3; i++) await attendi();
}

async function invia(s: ReturnType<typeof accendi>) {
  const form = document.querySelector('form');
  expect(form, 'controprova: il modulo del reclamo si deve vedere').toBeTruthy();
  s.agisci(() => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 15; i++) await attendi();
}

/** Scrive un reclamo e lo manda con la sessione scaduta (la rotta risponde 401), poi chiude la pagina. */
async function scadeMentreScrivo(testo = TESTO_A, ordine = 'o-1') {
  const s = await apri(ordine);
  await scegliEScrivi(s, 'not_received', testo);
  await invia(s);
  expect(chiamate.at(-1)?.url, 'controprova: il reclamo doveva arrivare alla rotta del server').toBe('/api/disputes');
  s.smonta();
}

describe('R01-003 · con la sessione scaduta il reclamo chiede di rientrare e il testo non si perde', () => {
  it('401: avviso con il link che torna al reclamo, pulsante di nuovo usabile, e al ritorno il testo è nel modulo', async () => {
    const s = await apri();
    await scegliEScrivi(s, 'damaged', TESTO_A);
    await invia(s);

    const avviso = Array.from(document.querySelectorAll('[role="alert"]')).find((x) => /sessione è scaduta/i.test(x.textContent ?? ''));
    expect(avviso, 'con la sessione scaduta la pagina non chiede di rientrare').toBeTruthy();
    const link = avviso!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/sign-in?returnTo=%2Forders%2Fo-1%2Fdispute');
    expect(testoVisibile(link)).toMatch(/Rientra/);
    expect(bottone()?.disabled, 'dopo il 401 il pulsante resta spento').toBe(false);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'il testo scritto non è stato tenuto da parte').not.toBeNull();
    s.smonta();

    // Rientrata, la cliente torna sulla pagina del reclamo nella stessa scheda.
    const dopo = await apri();
    expect(area()?.value, 'al ritorno dall’accesso il testo scritto è perso').toBe(TESTO_A);
    expect(motivoScelto()).toBe('damaged');
    dopo.smonta();
  }, 60000);

  it('il testo cambiato dopo il 401, prima di rientrare, è quello che si ritrova', async () => {
    const s = await apri();
    await scegliEScrivi(s, 'damaged', TESTO_A);
    await invia(s);
    scrivi(s, TESTO_B);
    for (let i = 0; i < 3; i++) await attendi();
    s.smonta();

    const dopo = await apri();
    expect(area()?.value).toBe(TESTO_B);
    dopo.smonta();
  }, 60000);

  it('la bozza di un ordine non entra nel reclamo di un altro', async () => {
    await scadeMentreScrivo(TESTO_A, 'o-1');
    const altro = await apri('o-2');
    expect(area()?.value).toBe('');
    expect(motivoScelto()).toBe('');
    altro.smonta();
    expect(window.sessionStorage.getItem(chiave('o-1')), 'la bozza dell’altro ordine resta sua').not.toBeNull();
  }, 60000);

  it('il reclamo partito cancella la bozza', async () => {
    const s = await apri();
    await scegliEScrivi(s, 'damaged', TESTO_A);
    await invia(s);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'controprova: dopo il 401 la bozza c’è').not.toBeNull();
    mondo.risposte = [201];
    await invia(s);
    expect(chiamate).toHaveLength(2);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'il reclamo è partito ma la bozza resta nella scheda').toBeNull();
    s.smonta();
  }, 60000);

  it('la bozza tornata nel modulo si cancella: un testo cambiato e lasciato lì non viene sostituito dalla bozza vecchia', async () => {
    await scadeMentreScrivo(TESTO_A);
    const ritorno = await apri();
    expect(area()?.value, 'controprova: al ritorno il testo deve tornare').toBe(TESTO_A);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'la bozza tornata nel modulo resta nella scheda').toBeNull();
    scrivi(ritorno, TESTO_B);
    for (let i = 0; i < 3; i++) await attendi();
    ritorno.smonta();

    // Esce senza mandare, poi riapre la pagina nella stessa scheda.
    const ancora = await apri();
    expect(area()?.value, 'riaprendo la pagina torna il testo vecchio, non quello lasciato').not.toBe(TESTO_A);
    ancora.smonta();
  }, 60000);

  it('svuotato il campo per lasciar perdere, alla visita dopo il testo vecchio non torna', async () => {
    await scadeMentreScrivo(TESTO_A);
    const ritorno = await apri();
    expect(area()?.value, 'controprova: al ritorno il testo deve tornare').toBe(TESTO_A);
    scrivi(ritorno, '');
    for (let i = 0; i < 3; i++) await attendi();
    ritorno.smonta();

    const ancora = await apri();
    expect(area()?.value, 'il campo svuotato torna pieno del testo vecchio').toBe('');
    ancora.smonta();
  }, 60000);

  it('con un reclamo già aperto la bozza si cancella', async () => {
    await scadeMentreScrivo(TESTO_A);
    mondo.aperti = [{ created_at: '2026-11-12T09:00:00Z', status: 'open' }];
    const s = await apri();
    expect(testoVisibile(document.body), 'controprova: c’è già un reclamo aperto').toMatch(/Hai già un reclamo aperto/);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'il reclamo è già aperto ma la bozza resta nella scheda').toBeNull();
    s.smonta();

    mondo.aperti = [];
    const dopo = await apri();
    expect(area()?.value).toBe('');
    dopo.smonta();
  }, 60000);

  // Terza passata (collaudo): dopo il 401 un nuovo invio che cade per la rete o per un errore del
  // server lasciava nella scheda il testo di prima, e alla visita dopo quello prendeva il posto
  // dell'ultimo scritto.
  for (const [come, stato] of [['la rete cade', 0], ['il server risponde 500', 500], ['il server risponde 400', 400]] as const) {
    it(`dopo il 401 un nuovo invio fallito (${come}): alla visita dopo c’è l’ultimo testo scritto, non quello di prima`, async () => {
      const s = await apri();
      await scegliEScrivi(s, 'damaged', TESTO_A);
      await invia(s);
      expect(window.sessionStorage.getItem(chiave('o-1')), 'controprova: dopo il 401 la bozza c’è').not.toBeNull();
      mondo.risposte = [stato];
      await invia(s);
      expect(chiamate, 'controprova: il secondo invio doveva partire').toHaveLength(2);
      scrivi(s, TESTO_B);
      for (let i = 0; i < 3; i++) await attendi();
      s.smonta();

      const dopo = await apri();
      expect(area()?.value, 'alla visita dopo torna il testo di prima, non l’ultimo scritto').toBe(TESTO_B);
      dopo.smonta();
    }, 60000);
  }

  it('la bozza riprende il testo solo per chi l’ha scritto', async () => {
    await scadeMentreScrivo(TESTO_A);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'controprova: dopo il 401 la bozza c’è').not.toBeNull();

    globali.__UTENTE__ = { id: 'u-bruno', email: 'bruno@test.it' };
    const s = await apri();
    expect(area()?.value).toBe('');
    expect(motivoScelto()).toBe('');
    expect(window.sessionStorage.getItem(chiave('o-1'))).toBeNull();
    s.smonta();
  }, 60000);
});
