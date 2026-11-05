/**
 * @vitest-environment jsdom
 */

/**
 * 1/11/2026 — LA POSIZIONE DEL FATTORINO SI SPEGNE DAVVERO.
 *
 * Due buchi sulla pagina della consegna, stesso effetto: il telefono continuava
 * a mandare la posizione mentre la pagina diceva che era spenta, o su un
 * ordine ormai chiuso.
 *  ① Ordine annullato con il GPS acceso: la sorveglianza si fermava solo col
 *    codice di consegna giusto, e la posizione si scriveva sull'ordine chiuso.
 *  ② Segnale perso: la pagina tornava a «Attiva il GPS» ma la sorveglianza
 *    restava accesa; premendo di nuovo «Attiva GPS» la vecchia perdeva il suo
 *    numero e non si fermava piu', neanche dopo la consegna.
 *
 * Qui la pagina si MONTA davvero con un GPS finto che tiene il conto delle
 * sorveglianze accese.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';
import { attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const ORDINE = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';

function ordine(sopra: Record<string, unknown> = {}) {
  return {
    id: ORDINE,
    user_id: 'cliente-1',
    seller_id: 'negozio-1',
    total_price: 25,
    shipping_cost: 0,
    rider_fee_cents: 300,
    pickup_in_store: false,
    delivery_status: 'OUT_FOR_DELIVERY',
    created_at: '2026-10-14T17:00:00Z',
    accepted_at: '2026-10-14T17:05:00Z',
    ready_at: null,
    picked_up_at: '2026-10-14T17:30:00Z',
    delivered_at: null,
    canceled_at: null,
    payment_method: 'card',
    cash_confirmed_at: null,
    delivery_full_name: 'Maria Rossi',
    delivery_phone: '3331234567',
    delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza',
    delivery_zip: '29121',
    delivery_notes: null,
    delivery_lat: null,
    delivery_lng: null,
    seller: { store_name: 'Pane Quotidiano', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null },
    order_items: [{ id: 'r1', quantity: 1, unit_price: 25, products: { name: 'Pane' } }],
    ...sopra,
  };
}

type Sorveglianza = { ok: (p: unknown) => void; ko: (e: unknown) => void };
/** Un GPS finto: sa quali sorveglianze sono ancora accese. */
function gpsFinto() {
  let prossimo = 1;
  const accese = new Map<number, Sorveglianza>();
  const geo = {
    watchPosition: (ok: Sorveglianza['ok'], ko: Sorveglianza['ko']) => {
      const n = prossimo++;
      accese.set(n, { ok, ko });
      return n;
    },
    clearWatch: (n: number) => {
      accese.delete(n);
    },
    getCurrentPosition: () => {},
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  return accese;
}

let radice: HTMLDivElement;
let root: Root;
let Pagina: ComponentType<Record<string, unknown>>;
let dato: Record<string, unknown>;

async function accendiPagina() {
  globali.__DATI_QUERY__ = () => dato;
  Pagina = (await monta('app/rider/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  await act(async () => {
    root = createRoot(radice);
    root.render(createElement(Pagina, { params: { id: ORDINE } }));
  });
  await attendi();
}

/** La pagina riceve dal database lo stato nuovo dell'ordine (come dopo un aggiornamento). */
async function ridisegna() {
  await act(async () => {
    root.render(createElement(Pagina, { params: { id: ORDINE } }));
  });
  await attendi();
}

async function premiAttivaGps() {
  const b = Array.from(radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Attiva GPS'));
  expect(b, 'il pulsante «Attiva GPS» non c e').toBeTruthy();
  await act(async () => clicca(b!));
  await attendi();
}

describe('la posizione del fattorino', () => {
  beforeEach(() => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    dato = ordine();
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    radice?.remove();
    globali.__DATI_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    globali.__CLIENT_SUPABASE__ = undefined;
    document.body.innerHTML = '';
  });

  it('si spegne quando l ordine viene annullato mentre il GPS e acceso', async () => {
    const accese = gpsFinto();
    await accendiPagina();
    await premiAttivaGps();
    expect(accese.size).toBe(1);

    dato = ordine({ delivery_status: 'CANCELED', canceled_at: '2026-10-14T17:40:00Z' });
    await ridisegna();
    expect(accese.size, 'ordine annullato e la posizione continua a scriversi').toBe(0);
  }, 60000);

  // 5/11/2026 (sessione S02, scheda 2665) — Un calo di segnale passeggero (codice 2 o 3) non spegne
  // più la condivisione: il telefono riprova da solo. Si spegne col permesso negato (codice 1), e
  // allora si spegne davvero, sorveglianza compresa: è quello che questa prova controlla.
  it('si spegne davvero quando il GPS perde il permesso, e non resta accesa dopo un secondo «Attiva GPS»', async () => {
    const accese = gpsFinto();
    await accendiPagina();
    await premiAttivaGps();
    const [prima] = Array.from(accese.values());
    await act(async () => prima.ko({ code: 3, message: 'Timeout' }));
    await attendi();
    expect(radice.textContent, 'un segnale lento non spegne la condivisione').toContain('Posizione condivisa');
    expect(accese.size).toBe(1);
    await act(async () => prima.ko({ code: 1, message: 'User denied Geolocation' }));
    await attendi();
    expect(radice.textContent).toContain('Attiva il GPS per il cliente');
    expect(accese.size, 'la pagina dice «spenta» ma la sorveglianza manda ancora la posizione').toBe(0);

    await premiAttivaGps();
    expect(accese.size).toBe(1);
    dato = ordine({ delivery_status: 'DELIVERED', delivered_at: '2026-10-14T17:50:00Z' });
    await ridisegna();
    expect(accese.size, 'dopo la consegna c e ancora una sorveglianza accesa').toBe(0);
  }, 60000);
  it('scrive la posizione solo su un ordine ancora in strada: la scrittura porta il filtro sullo stato', async () => {
    // Un client che annota ogni scrittura su orders con i suoi filtri.
    const scritture: { valori: Record<string, unknown>; filtri: [string, string, unknown][] }[] = [];
    const catena = (tavola: string): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      const passa = () => c;
      for (const m of ['select', 'order', 'limit', 'maybeSingle', 'single', 'is', 'neq', 'gte', 'lte']) c[m] = passa;
      c.eq = passa;
      c.in = passa;
      c.update = (valori: Record<string, unknown>) => {
        const riga = { valori, filtri: [] as [string, string, unknown][] };
        if (tavola === 'orders') scritture.push(riga);
        const u: Record<string, unknown> = {
          eq: (col: string, v: unknown) => (riga.filtri.push(['eq', col, v]), u),
          in: (col: string, v: unknown) => (riga.filtri.push(['in', col, v]), u),
          then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
        };
        return u;
      };
      c.then = (ok: (x: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return c;
    };
    globali.__CLIENT_SUPABASE__ = { from: catena };

    const accese = gpsFinto();
    await accendiPagina();
    await premiAttivaGps();
    const [sorveglianza] = Array.from(accese.values());
    await act(async () => sorveglianza.ok({ coords: { latitude: 45.05, longitude: 9.69 } }));
    await attendi();

    const posizione = scritture.filter((w) => 'rider_lat' in w.valori);
    expect(posizione.length, 'la posizione non e stata scritta').toBe(1);
    const filtroStato = posizione[0].filtri.find(([tipo, col]) => tipo === 'in' && col === 'delivery_status');
    expect(filtroStato, 'la scrittura della posizione non guarda lo stato dell ordine').toBeTruthy();
    const stati = filtroStato![2] as string[];
    expect(stati).not.toContain('CANCELED');
    expect(stati).not.toContain('DELIVERED');
  }, 60000);
});
