/**
 * @vitest-environment jsdom
 */

/**
 * 1/11/2026 — DUE COSE CHE LA PAGINA DELL'ORDINE DEL CLIENTE DICEVA STORTE.
 *
 *  ① Nella scheda del fattorino il pulsante «Contatta il rider» apriva un
 *    pannello col nome del fattorino ma il numero del NEGOZIO: il cliente che
 *    voleva dire «suona al secondo campanello» chiamava il fornaio.
 *  ② Chiesto il reso, la pagina dell'ordine non ne sapeva niente: il pulsante
 *    «Richiedi reso» restava li', e il cliente ricompilava tutto per sentirsi
 *    dire dal server che una richiesta esisteva gia'.
 *
 * La pagina si MONTA davvero, con l'ordine e i resi in mano.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const ORDINE = 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb';
const TELEFONO_NEGOZIO = '0523 111222';

function ordine(sopra: Record<string, unknown> = {}) {
  return {
    id: ORDINE,
    total_price: 25,
    shipping_cost: 0,
    delivery_fee_cents: 0,
    discount_amount: 0,
    wallet_applied_cents: 0,
    pickup_in_store: false,
    delivery_slot: null,
    delivery_status: 'OUT_FOR_DELIVERY',
    payment_status: 'paid',
    payment_method: 'card',
    stripe_refund_id: null,
    created_at: '2026-10-14T17:00:00Z',
    accepted_at: '2026-10-14T17:05:00Z',
    ready_at: '2026-10-14T17:20:00Z',
    picked_up_at: '2026-10-14T17:30:00Z',
    delivered_at: null,
    delivery_full_name: 'Maria Rossi',
    delivery_phone: '3331234567',
    delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza',
    delivery_zip: '29121',
    delivery_notes: null,
    delivery_lat: null,
    delivery_lng: null,
    rider_lat: null,
    rider_lng: null,
    rider_position_updated_at: null,
    rider_id: 'fattorino-1',
    seller_id: 'negozio-1',
    seller: { store_name: 'Pane Quotidiano', store_logo: null, store_phone: TELEFONO_NEGOZIO, store_address: 'Via Roma 1', store_lat: null, store_lng: null },
    rider: { full_name: 'Luca Verdi' },
    order_items: [{ id: 'r1', quantity: 1, unit_price: 25, product_id: 'p1', product_name: 'Pane', product_image: null, products: { name: 'Pane', images: null } }],
    ...sopra,
  };
}

async function pagina(datiOrdine: Record<string, unknown>, resi: unknown[] = []) {
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
    const k = o.queryKey;
    if (k.includes('resi')) return resi;
    if (k.includes(ORDINE) && k.length <= 3 && !k.some((x) => typeof x === 'string' && /code/i.test(x))) return datiOrdine;
    return undefined;
  };
  const mod = await monta('app/orders/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: ORDINE } });
  await attendi();
  return s;
}

afterEach(() => {
  globali.__DATI_QUERY__ = undefined;
  document.body.innerHTML = '';
});

describe('variante collaudo B2: un reso aperto si puo ancora ritirare', () => {
  const consegnato = () => ordine({ delivery_status: 'DELIVERED', delivered_at: '2026-10-14T17:50:00Z' });
  for (const stato of ['REQUESTED', 'APPROVED']) {
    it(`con un reso ${stato} la pagina dell ordine porta ancora alla richiesta (dove c e «Ritira la richiesta»)`, async () => {
      const s = await pagina(consegnato(), [{ id: 'reso-1', status: stato, created_at: '2026-10-15T09:00:00Z' }]);
      const versoIlReso = Array.from(s.radice.querySelectorAll('a')).filter((a) =>
        (a.getAttribute('href') ?? '').endsWith(`/orders/${ORDINE}/return`),
      );
      expect(versoIlReso.length, 'nessun link alla richiesta di reso: il cliente non puo piu ritirarla').toBeGreaterThan(0);
      s.smonta();
    }, 60000);
  }
});
