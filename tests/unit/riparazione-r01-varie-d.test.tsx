/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

/**
 * R01-varie — La bozza del modulo di reclamo e la risposta che arriva dopo la fine della sessione.
 *
 * Il modulo tiene la bozza (sessionStorage, `mycity:bozza-reclamo:<ordine>`) quando il server
 * risponde 401. Se però, mentre la risposta era in viaggio, c'è stata un'uscita voluta («Esci»: il
 * fornitore delle domande ha già tolto le bozze), o la sessione del browser è passata a un altro
 * account, al 401 la bozza non si scrive; e dopo un'uscita voluta il modulo ancora aperto non la
 * riscrive più. Con la sessione scaduta da sola (nessuna uscita voluta) la bozza si tiene come prima.
 *
 * Si monta QueryProvider vero (col client Supabase finto delle prove, lo stesso oggetto che la prova
 * usa per premere «Esci») intorno alla pagina vera del reclamo. La rotta del server è finta e può
 * trattenere la risposta finché la prova non la rilascia.
 */

vi.mock('@/lib/supabase/client', async () => await import('./aiuti/finti/supabase-client.mjs'));

import QueryProvider from '@/components/providers/QueryProvider';
import { supabase } from '@/lib/supabase/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const globali = globalThis as Record<string, unknown>;
type Ascolto = (evento: string, sessione: { user: { id: string } } | null) => void;
const ascolti = () => [...((globali.__ASCOLTI_AUTH__ as Ascolto[] | undefined) ?? [])];

const mondo = { trattieni: false, rilascia: null as null | ((stato: number) => void), chiamate: 0 };

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

/** «Esci»: la chiamata passa dal client che il fornitore avvolge, come ogni tasto «Esci» del sito. */
async function esci() {
  await act(async () => {
    await supabase.auth.signOut();
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

/** Sceglie il motivo, scrive e preme «Apri reclamo»: la risposta del server resta in viaggio. */
async function inviaETrattieni() {
  const radio = document.querySelector('input[name="reason"][value="not_received"]') as HTMLInputElement | null;
  expect(radio, 'controprova: le scelte del motivo si devono vedere').toBeTruthy();
  await act(async () => radio!.click());
  await scrivi(TESTO);
  mondo.trattieni = true;
  const form = document.querySelector('form');
  await act(async () => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await lascia();
  expect(mondo.rilascia, 'controprova: la richiesta al server doveva essere in viaggio').toBeTruthy();
}

async function rilascia401() {
  mondo.rilascia!(401);
  mondo.trattieni = false;
  await lascia();
  expect(mondo.chiamate, 'controprova: il reclamo doveva arrivare alla rotta del server').toBe(1);
}

const avvisoScaduta = () =>
  Array.from(document.querySelectorAll('[role="alert"]')).find((x) => /sessione è scaduta/i.test(x.textContent ?? '')) ?? null;

beforeEach(() => {
  window.sessionStorage.clear();
  mondo.trattieni = false;
  mondo.rilascia = null;
  mondo.chiamate = 0;
  globali.__ASCOLTI_AUTH__ = [];
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__AUTH_FINTA__ = {
    // Come il client vero: la sessione si chiude e gli ascolti sono avvisati prima che finisca.
    signOut: async () => {
      globali.__UTENTE__ = null;
      for (const a of ascolti()) a('SIGNED_OUT', null);
      return { error: null };
    },
  };
  vi.stubGlobal('fetch', vi.fn(async () => {
    mondo.chiamate += 1;
    const stato = mondo.trattieni ? await new Promise<number>((r) => { mondo.rilascia = r; }) : 401;
    if (stato === 401) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticazione richiesta' } }), { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true, data: { id: 'd-1', status: 'open' } }), { status: 201 });
  }));
});

afterEach(async () => {
  if (radice) await act(async () => radice!.unmount());
  radice = null;
  contenitore?.remove();
  contenitore = null;
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  for (const k of ['__ASCOLTI_AUTH__', '__UTENTE__', '__CLIENT_SUPABASE__', '__AUTH_FINTA__']) delete globali[k];
});

describe('R01-varie · la bozza del reclamo e la risposta che arriva dopo la fine della sessione', () => {
  it('«Esci» mentre l’invio è in viaggio: al 401 che arriva dopo non resta nessuna bozza', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaETrattieni();

    await esci();
    expect(globali.__UTENTE__, 'controprova: «Esci» deve chiudere la sessione').toBeNull();
    await rilascia401();
    expect(bozza(), 'dopo «Esci» il 401 arrivato dopo ha scritto la bozza nella scheda').toBeNull();
    expect(avvisoScaduta()?.textContent ?? '', 'dopo «Esci» la pagina dice che il testo è salvato').not.toMatch(/resta salvato/);

    // Chi era uscito rientra: non c'è niente da ritrovare.
    await avvisa('SIGNED_IN', 'u1');
    expect(bozza()).toBeNull();
  }, 60000);

  it('la sessione del browser è passata a un altro account mentre l’invio era in viaggio: al 401 la bozza non si scrive', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaETrattieni();

    await avvisa('SIGNED_IN', 'u2');
    await rilascia401();
    expect(bozza(), 'entrato un altro account, il 401 ha scritto nella scheda la bozza di chi aveva aperto il modulo').toBeNull();
  }, 60000);

  it('dopo il 401 «Esci» toglie la bozza, e il modulo ancora aperto non la riscrive', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaETrattieni();
    await rilascia401();
    expect(bozza()?.perIlRientro, 'controprova: con la sessione scaduta la bozza per il rientro si tiene').toBe(true);

    await esci();
    expect(bozza(), 'controprova: «Esci» toglie la bozza').toBeNull();
    await scrivi(TESTO_DOPO);
    expect(bozza(), 'dopo «Esci» il modulo ancora aperto ha riscritto la bozza').toBeNull();
  }, 60000);

  it('con la sessione scaduta da sola (nessun «Esci») la bozza si tiene come prima, e la pagina lo dice', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    await inviaETrattieni();

    await avvisa('SIGNED_OUT', null);
    await rilascia401();
    expect(bozza()?.perIlRientro, 'con la sessione scaduta la bozza per il rientro non c’è').toBe(true);
    expect(bozza()?.utente).toBe('u1');
    expect(bozza()?.description).toBe(TESTO);
    expect(avvisoScaduta()?.textContent ?? '').toMatch(/resta salvato/);

    await scrivi(TESTO_DOPO);
    expect(bozza()?.description, 'la bozza non segue più il modulo dopo il 401').toBe(TESTO_DOPO);
  }, 60000);
});
