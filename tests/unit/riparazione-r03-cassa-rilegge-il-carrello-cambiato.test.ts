/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { databaseCoiPermessi, OGGI, type Dati } from './aiuti/database-coi-permessi';

/**
 * R03-012 — La cassa non ordina la quantità o la taglia vecchia se torni al carrello, la cambi
 * e rientri entro mezzo minuto.
 *
 * La lettura dei gruppi della cassa (`checkout-groups`) restituisce le righe intere del
 * carrello, con quantità e variante, ma la sua chiave era fatta solo di `id:sellerId`. Col
 * QueryClient condiviso (staleTime 30 s) e la navigazione senza ricaricare, cambiare la
 * quantità lasciava la chiave uguale: React Query restituiva la copia vecchia e il corpo verso
 * /api/orders/cod partiva con 1 filone invece di 3. Ora quantità e variante stanno nella chiave.
 *
 * Qui la cassa si monta due volte con lo stesso finto `useQuery` (che risponde per chiave, come
 * la cache vera), cambiando il carrello fra i due ingressi.
 */

const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const MARIA = 'cccccccc-3333-4333-8333-cccccccccccc';
const FILONE = 'dddddddd-4444-4444-8444-dddddddddddd';
const VARIANTE_M = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const VARIANTE_L = 'ffffffff-6666-4666-8666-ffffffffffff';

function dati(): Dati {
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', store_lat: 45.0526, store_lng: 9.6929, store_hours: null },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi', wallet_balance_cents: 0 },
    ],
    products: [
      { id: FILONE, name: 'Filone', price: 3, images: null, seller_id: PANE, status: 'available', stock: 10, has_variants: false, express_enabled: false },
    ],
    user_addresses: [],
    pending_checkouts: [{ buyer_id: 'altro-cliente', status: 'PENDING', groups: [] }],
  };
}

const globale = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: readonly unknown[] };

/** Monta la cassa col carrello dato e restituisce la chiave chiesta per i gruppi. */
async function chiaveDeiGruppi(carrello: Array<Record<string, unknown>>): Promise<string> {
  const db = databaseCoiPermessi(dati(), OGGI, MARIA, { product_active_discounts: () => [] });
  globale.__CLIENT_SUPABASE__ = db.client;
  globale.__UTENTE__ = { id: MARIA, email: 'maria@test.it' };
  localStorage.setItem('cart', JSON.stringify(carrello));
  const chieste: string[] = [];
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    if (o.queryKey[0] === 'checkout-groups') chieste.push(JSON.stringify(o.queryKey));
    return undefined;
  };
  globale.__ESITO_QUERY__ = () => undefined;
  const pagina = (await monta('app/checkout/page.tsx')).default;
  const s = accendi(pagina, {});
  await attendi();
  s.smonta();
  expect(chieste.length, 'la cassa non ha chiesto i gruppi').toBeGreaterThan(0);
  return chieste[chieste.length - 1];
}

const riga = (extra: Record<string, unknown>) => ({ id: FILONE, name: 'Filone', price: 3, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano', ...extra });

beforeEach(() => localStorage.clear());

describe('R03-012 — la cassa rilegge il carrello cambiato', () => {
  it('1 filone, poi 3: la chiave della lettura dei gruppi cambia (la copia vecchia non si riusa)', async () => {
    const prima = await chiaveDeiGruppi([riga({ quantity: 1 })]);
    const dopo = await chiaveDeiGruppi([riga({ quantity: 3 })]);
    expect(dopo, 'con la stessa chiave React Query restituisce il carrello con 1 filone').not.toBe(prima);
  });

  it('taglia M tolta e L aggiunta: la chiave cambia', async () => {
    const prima = await chiaveDeiGruppi([riga({ variantId: VARIANTE_M })]);
    const dopo = await chiaveDeiGruppi([riga({ variantId: VARIANTE_L })]);
    expect(dopo).not.toBe(prima);
  });

  it('lo stesso carrello dà la stessa chiave (la cache serve ancora)', async () => {
    const prima = await chiaveDeiGruppi([riga({ quantity: 2 })]);
    const dopo = await chiaveDeiGruppi([riga({ quantity: 2 })]);
    expect(dopo).toBe(prima);
  });
});
