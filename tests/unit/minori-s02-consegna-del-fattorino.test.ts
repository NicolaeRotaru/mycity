/**
 * @vitest-environment jsdom
 */

/**
 * Sessione S02 (5/11/2026) — la pagina della consegna del fattorino, montata davvero (banco copiato
 * da il-gps-del-fattorino-si-spegne-davvero).
 *  · 1710: senza coordinate «Naviga» c'è, e apre le mappe con l'indirizzo scritto;
 *  · 1711: il pulsante che apre gli SMS si chiama «SMS», non «Chat»;
 *  · 149:  ordine annullato: niente scheda «Consegna al cliente», niente «Incassa», un avviso chiaro;
 *  · 317 / 2521: «Cliente assente» c'è anche da «ritirato», e chiama la rotta giusta;
 *  · 2665: un calo di segnale non spegne la condivisione e il messaggio è in italiano;
 *  · 396:  da 50 € in su la pagina non dice «la foto è facoltativa».
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

const testo = () => radice.textContent ?? '';
const pulsanteCon = (t: RegExp) => Array.from(radice.querySelectorAll('a, button')).find((b) => t.test(b.textContent ?? '')) as HTMLElement | undefined;

describe('la pagina della consegna del fattorino', () => {
  beforeEach(() => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    dato = ordine();
    gpsFinto();
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    radice?.remove();
    globali.__DATI_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    document.body.innerHTML = '';
  });

  it('1710 · senza coordinate «Naviga» c è e porta all indirizzo scritto', async () => {
    await accendiPagina();
    expect(testo()).toContain('Mappa non disponibile');
    const naviga = pulsanteCon(/^\s*Naviga\s*$/) as HTMLAnchorElement | undefined;
    expect(naviga, 'la mappa vuota dice di toccare «Naviga» e il pulsante non c è').toBeTruthy();
    expect(decodeURIComponent(naviga!.getAttribute('href') ?? '')).toContain('Via Verdi 10 29121 Piacenza');
  }, 60000);

  it('1711 · il pulsante degli SMS si chiama «SMS»', async () => {
    await accendiPagina();
    const sms = Array.from(radice.querySelectorAll('a')).find((a) => (a.getAttribute('href') ?? '').startsWith('sms:'));
    expect(sms?.textContent).toContain('SMS');
    expect(sms?.textContent).not.toContain('Chat');
  }, 60000);

  it('149 · ordine annullato in strada: niente «Consegna al cliente» né «Incassa», un avviso chiaro', async () => {
    dato = ordine({ delivery_status: 'CANCELED', payment_method: 'cod', canceled_at: '2026-10-14T17:40:00Z' });
    await accendiPagina();
    expect(testo()).toContain('Ordine annullato: non consegnare e non incassare');
    expect(testo()).not.toContain('Consegna al cliente');
    expect(testo()).not.toMatch(/Incassa\s/);
  }, 60000);

  it('317 · da «ritirato» c è «Cliente assente»', async () => {
    dato = ordine({ delivery_status: 'PICKED_UP' });
    await accendiPagina();
    expect(pulsanteCon(/Cliente assente/)).toBeTruthy();
  }, 60000);

  it('2521 · «Cliente assente» parte dopo la conferma e la sua azione chiama la rotta giusta', async () => {
    const mutazioni: unknown[] = [];
    globali.__MUTAZIONI__ = mutazioni;
    const confermaVera = window.confirm;
    let domande = 0;
    window.confirm = () => { domande++; return true; };
    try {
      await accendiPagina();
      await act(async () => clicca(pulsanteCon(/Cliente assente/)!));
      await attendi();
      expect(domande, 'nessuna conferma prima di annullare').toBe(1);
      expect(mutazioni).toHaveLength(1);
    } finally {
      window.confirm = confermaVera;
      globali.__MUTAZIONI__ = undefined;
    }
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/rider/orders/[id]/page.tsx', 'utf8');
    const blocco = src.slice(src.indexOf('const clienteAssente = useMutation({'), src.indexOf('const clienteAssente = useMutation({') + 400);
    expect(blocco).toContain("fetch(`/api/rider/orders/${id}/cliente-assente`, { method: 'POST' })");
  }, 60000);

  it('396 · contanti da 58 €: la pagina non dice «la foto è facoltativa»', async () => {
    dato = ordine({ payment_method: 'cod', total_price: 58 });
    await accendiPagina();
    expect(testo()).toContain('Da 50 € in su serve la foto dei contanti');
    expect(testo()).not.toContain('La foto è facoltativa');
  }, 60000);
});

describe('2665 · il messaggio del GPS', () => {
  it('è in italiano e distingue il permesso negato dal segnale debole', async () => {
    const { messaggioErroreGps } = await import('@/lib/rider/errore-gps');
    expect(messaggioErroreGps(1)).toContain('permesso');
    expect(messaggioErroreGps(2)).toContain('riprovo da solo');
    expect(messaggioErroreGps(3)).toContain('riprovo da solo');
  });
});
