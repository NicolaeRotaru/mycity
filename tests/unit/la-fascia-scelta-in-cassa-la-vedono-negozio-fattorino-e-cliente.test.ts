/**
 * @vitest-environment jsdom
 */

/**
 * 29/10/2026 — LA FASCIA DI CONSEGNA CHE NESSUNO VEDEVA.
 *
 * In cassa il cliente sceglie quando ricevere la spesa («Domani · 9:00–12:00») e la scelta
 * finisce su `orders.delivery_slot`. Da lì la leggevano solo due controlli automatici: la
 * pagina dell'ordine del negozio, la sua lista, la bacheca e la scheda del fattorino e la
 * pagina dell'ordine del cliente non la chiedevano nemmeno al database. Al lancio la
 * consegna da 3 euro è quella nella fascia scelta: se la fascia non la vede nessuno, la
 * promessa per cui il cliente paga non la può mantenere nessuno.
 *
 * E la fascia salvata è relativa: «Domani» è vero solo il giorno in cui l'ordine è nato.
 * Qui la si vuole a schermo nel giorno vero: un ordine di lunedì 2/11 con «Domani ·
 * 9:00–12:00» si legge «mar 3/11 · 9:00–12:00».
 *
 * Le pagine vengono MONTATE e le loro letture girano davvero (con la queryFn vera) contro un
 * database finto che risponde SOLO con le colonne chieste: una pagina che mostra la fascia
 * ma si dimentica di leggerla resta rossa.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { fasciaLeggibile } from '@/lib/ordini/fascia-leggibile';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

const g = globalThis as Record<string, unknown>;

const ORDINE = 'bbbbbbbb-1313-4313-8313-bbbbbbbbbbbb';
const ORDINE_LIBERO = 'cccccccc-1313-4313-8313-cccccccccccc';
/** Lunedì 2 novembre 2026, le 11 a Piacenza. */
const NATO_LUNEDI = '2026-11-02T10:00:00Z';
const DOMANI_MATTINA = 'Domani · 9:00–12:00';
const MARTEDI_MATTINA = 'mar 3/11 · 9:00–12:00';

function riga(sopra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDINE, user_id: 'cliente-1', seller_id: 'negozio-1', rider_id: 'rider-1',
    total_price: 25, shipping_cost: 3, delivery_fee_cents: 300, discount_amount: 0,
    wallet_applied_cents: 0, rider_fee_cents: 300, pickup_in_store: false,
    delivery_status: 'ACCEPTED', payment_status: 'pending', payment_method: 'cod',
    stripe_refund_id: null, cash_confirmed_at: null,
    delivery_slot: DOMANI_MATTINA, created_at: NATO_LUNEDI,
    accepted_at: '2026-11-02T10:05:00Z', ready_at: null, picked_up_at: null,
    delivered_at: null, canceled_at: null,
    delivery_full_name: 'Maria Rossi', delivery_phone: '3331234567',
    delivery_address: 'Via Verdi 10', delivery_city: 'Piacenza', delivery_zip: '29121',
    delivery_notes: null, delivery_lat: null, delivery_lng: null,
    rider_lat: null, rider_lng: null, rider_position_updated_at: null,
    seller: { store_name: 'Pane Quotidiano', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null, store_logo: null },
    rider: { full_name: 'Luca Verdi' },
    order_items: [{ id: 'r1', quantity: 2, unit_price: 11, product_name: 'Pane di Altamura', product_image: null, products: { name: 'Pane di Altamura', images: [] } }],
    ...sopra,
  };
}

/** Le colonne semplici di una select, senza le relazioni fra parentesi. */
function colonneChieste(select: string): string[] {
  let piatta = select;
  while (/\([^()]*\)/.test(piatta)) piatta = piatta.replace(/\([^()]*\)/g, '');
  return piatta.split(',').map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c));
}

const RELAZIONI = ['seller', 'rider', 'order_items'];

/**
 * Monta la pagina, esegue le letture che chiede con la loro funzione vera, rimonta finché
 * non ne chiede più: il testo a schermo alla fine.
 */
async function aSchermo(
  file: string,
  props: Record<string, unknown>,
  tavole: Record<string, Record<string, unknown>>,
): Promise<string> {
  g.__RISPOSTA_SUPABASE__ = ({ tavola, colonne }: { tavola: string; colonne?: string }) => {
    const r = tavole[tavola];
    if (!r) return { data: null, error: null };
    const solo: Record<string, unknown> = Object.fromEntries(
      colonneChieste(colonne ?? '').map((c) => [c, r[c] ?? null]),
    );
    for (const rel of RELAZIONI) if (rel in r) solo[rel] = r[rel];
    return { data: [solo], error: null };
  };
  const Pagina = (await monta(file)).default as ComponentType<Record<string, unknown>>;
  const risposte = new Map<string, unknown>();
  let testo = '';
  for (let giro = 0; giro < 6; giro++) {
    const daLeggere: Array<{ chiave: string; leggi: () => Promise<unknown> }> = [];
    g.__DATI_QUERY__ = (o: { queryKey: unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean; initialPageParam?: unknown }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (o.enabled !== false && o.queryFn && !risposte.has(chiave)) {
        const fn = o.queryFn;
        daLeggere.push({ chiave, leggi: () => fn({ pageParam: o.initialPageParam ?? 0, queryKey: o.queryKey }) });
      }
      return risposte.get(chiave);
    };
    const s = accendi(Pagina, props);
    await attendi();
    testo = s.radice.textContent ?? '';
    s.smonta();
    if (daLeggere.length === 0) break;
    for (const d of daLeggere) {
      if (!risposte.has(d.chiave)) risposte.set(d.chiave, await d.leggi().catch(() => null));
    }
  }
  return testo;
}

describe('la fascia salvata, detta come un giorno del calendario', () => {
  it('«Domani» diventa il giorno dopo quello in cui è nato l’ordine', () => {
    expect(fasciaLeggibile({ delivery_slot: DOMANI_MATTINA, created_at: NATO_LUNEDI })).toBe(MARTEDI_MATTINA);
    expect(fasciaLeggibile({ delivery_slot: 'Domani · 18:30–20:00', created_at: NATO_LUNEDI })).toBe('mar 3/11 · 18:30–20:00');
  });

  it('le fasce di oggi restano il giorno dell’ordine', () => {
    expect(fasciaLeggibile({ delivery_slot: 'In giornata · 15:00–18:00', created_at: NATO_LUNEDI })).toBe('lun 2/11 · 15:00–18:00');
    expect(fasciaLeggibile({ delivery_slot: 'Stasera · 18:00–20:00', created_at: NATO_LUNEDI })).toBe('lun 2/11 · 18:00–20:00');
  });

  it('il giorno si conta a Piacenza, non a Greenwich', () => {
    // Le 00:30 di martedì 3/11 a Piacenza sono ancora lunedì 2/11 in UTC.
    expect(fasciaLeggibile({ delivery_slot: DOMANI_MATTINA, created_at: '2026-11-02T23:30:00Z' })).toBe('mer 4/11 · 9:00–12:00');
  });

  it('a fine anno il giorno dopo è il primo gennaio', () => {
    expect(fasciaLeggibile({ delivery_slot: 'Domani · 18:30–20:00', created_at: '2026-12-31T12:00:00Z' })).toBe('ven 1/1 · 18:30–20:00');
  });

  it('la consegna veloce resta una durata', () => {
    expect(fasciaLeggibile({ delivery_slot: ETICHETTA_ADESSO, created_at: NATO_LUNEDI })).toBe(ETICHETTA_ADESSO);
  });

  it('senza una fascia vera non si inventa niente', () => {
    expect(fasciaLeggibile({ delivery_slot: null, created_at: NATO_LUNEDI })).toBeNull();
    expect(fasciaLeggibile({ delivery_slot: DOMANI_MATTINA, created_at: NATO_LUNEDI, pickup_in_store: true })).toBeNull();
    expect(fasciaLeggibile({ delivery_slot: 'Quando vuoi tu', created_at: NATO_LUNEDI })).toBeNull();
    expect(fasciaLeggibile({ delivery_slot: DOMANI_MATTINA, created_at: 'non è una data' })).toBeNull();
    expect(fasciaLeggibile({ delivery_slot: DOMANI_MATTINA, created_at: null })).toBeNull();
  });
});

describe('la fascia scelta in cassa si vede dove serve', () => {
  beforeEach(() => {
    g.__PROFILO__ = { isAuthenticated: true, isRider: true, isSeller: true, profile: { full_name: 'Luca Verdi' } };
  });
  afterEach(() => {
    delete g.__DATI_QUERY__;
    delete g.__RISPOSTA_SUPABASE__;
    delete g.__UTENTE__;
    delete g.__PROFILO__;
  });

  it('il negozio la legge sulla pagina dell’ordine', async () => {
    g.__UTENTE__ = { id: 'negozio-1' };
    const testo = await aSchermo('app/seller/orders/[id]/page.tsx', { params: { id: ORDINE } }, { orders: riga() });
    expect(testo, 'Il negozio non sa per quando preparare la spesa: la promessa fatta in cassa si perde').toContain(MARTEDI_MATTINA);
  }, 90000);

  it('su un ordine senza fascia il negozio non legge un orario inventato', async () => {
    g.__UTENTE__ = { id: 'negozio-1' };
    const testo = await aSchermo('app/seller/orders/[id]/page.tsx', { params: { id: ORDINE } }, { orders: riga({ delivery_slot: null }) });
    expect(testo).toContain('Maria Rossi');
    expect(testo).not.toContain('9:00–12:00');
  }, 90000);

  it('il negozio la legge nella lista degli ordini', async () => {
    g.__UTENTE__ = { id: 'negozio-1' };
    const testo = await aSchermo('app/seller/orders/page.tsx', {}, { orders: riga() });
    expect(testo, 'Dalla lista il negozio non vede quale ordine va consegnato prima').toContain(MARTEDI_MATTINA);
  }, 90000);

  it('il fattorino la legge sulla bacheca prima di accettare, e sulla consegna che ha preso', async () => {
    g.__UTENTE__ = { id: 'rider-1' };
    const testo = await aSchermo('app/rider/page.tsx', {}, {
      profiles: { rider_is_online: true, rider_zones: [] },
      ordini_disponibili_rider: {
        id: ORDINE_LIBERO, seller_id: 'negozio-1', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1',
        delivery_city: 'Piacenza', delivery_zip: '29121', delivery_status: 'READY', payment_method: 'cod',
        total_price: 25, shipping_cost: 3, rider_fee_cents: 300, delivery_slot: DOMANI_MATTINA, articoli: 2,
        created_at: NATO_LUNEDI,
      },
      orders: riga({ delivery_status: 'OUT_FOR_DELIVERY', delivery_slot: 'Stasera · 18:00–20:00' }),
    });
    expect(testo, 'Il fattorino accetta un ordine senza sapere quando va consegnato').toContain(MARTEDI_MATTINA);
    expect(testo, 'Sulla consegna che ha preso il fattorino non vede la fascia').toContain('lun 2/11 · 18:00–20:00');
  }, 90000);

  it('il fattorino la legge sulla scheda della consegna', async () => {
    g.__UTENTE__ = { id: 'rider-1' };
    const testo = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id: ORDINE } }, {
      orders: riga({ delivery_status: 'OUT_FOR_DELIVERY' }),
    });
    expect(testo, 'Sulla scheda della consegna non c’è l’orario promesso al cliente').toContain(MARTEDI_MATTINA);
  }, 90000);

  it('il cliente rilegge la fascia che ha scelto', async () => {
    g.__UTENTE__ = { id: 'cliente-1' };
    const testo = await aSchermo('app/orders/[id]/page.tsx', { params: { id: ORDINE } }, { orders: riga() });
    expect(testo, 'Il cliente non può ricontrollare quando gli arriva la spesa').toContain(MARTEDI_MATTINA);
  }, 90000);
});
