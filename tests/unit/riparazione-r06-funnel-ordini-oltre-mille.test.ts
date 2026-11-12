/**
 * @vitest-environment jsdom
 */
/**
 * R06-001 (12/11/2026) — IL FUNNEL CONTAVA MENO CLIENTI CHE COMPRANO DI QUELLI VERI.
 *
 * Gli ordini si leggevano con un blocco ogni cento clienti e UNA richiesta per
 * blocco. Il database ne restituisce al massimo mille: con cento clienti e piu'
 * di mille ordini, il resto si perdeva senza errore. «1° ordine mai» e
 * «Multi-buyer» crollavano proprio mentre il marketplace cresceva.
 *
 * Qui la lettura vera della pagina gira contro un finto database col tetto di
 * mille righe: cinquanta clienti con trenta ordini ciascuno (1.500 righe) e
 * cinquanta con un ordine solo. Il funnel deve contarli tutti e cento.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

type Lettura = { queryFn?: () => Promise<Record<string, unknown>> };
const globale = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
});

const GIORNO = 86_400_000;

function database() {
  const adesso = Date.now();
  const profiles: Riga[] = [];
  const orders: Riga[] = [];
  for (let i = 0; i < 100; i++) {
    profiles.push({ id: `cliente-${i}`, role: 'buyer', created_at: new Date(adesso - 80 * GIORNO).toISOString() });
  }
  let n = 0;
  // Prima, nella tabella, i 1.500 ordini dei cinquanta clienti abituali.
  for (let i = 0; i < 50; i++) {
    for (let k = 0; k < 30; k++) {
      orders.push({
        id: `o-${n++}`,
        user_id: `cliente-${i}`,
        created_at: new Date(adesso - (79 - 2 * k) * GIORNO + i * 1000).toISOString(),
        delivery_status: 'DELIVERED',
        payment_status: 'PAID',
        stripe_session_id: null,
      });
    }
  }
  // Poi i cinquanta clienti con un ordine solo, il giorno dopo l'iscrizione.
  for (let i = 50; i < 100; i++) {
    orders.push({
      id: `o-${n++}`,
      user_id: `cliente-${i}`,
      created_at: new Date(adesso - 1 * GIORNO + i * 1000).toISOString(),
      delivery_status: 'DELIVERED',
      payment_status: 'PAID',
      stripe_session_id: null,
    });
  }
  return creaPostgrestColTetto({ profiles, orders });
}

describe('R06-001 · il funnel con piu\' di mille ordini in un blocco di cento clienti', () => {
  it('conta tutti i clienti che hanno comprato, non solo quelli delle prime mille righe', async () => {
    let lettura: Lettura | null = null;
    globale.__DATI_QUERY__ = (opzioni: Lettura) => { lettura = opzioni; return undefined; };
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    s.smonta();
    expect(lettura, 'la pagina Funnel non ha una lettura da eseguire').not.toBeNull();

    const db = database();
    globale.__CLIENT_SUPABASE__ = db.client;
    const dati = await (lettura as unknown as Lettura).queryFn!();

    expect(dati.signups).toBe(100);
    expect(
      dati.firstOrderEver,
      'Il funnel si e\' fermato alle prime mille righe di ordini: dice meno clienti che comprano di quelli veri',
    ).toBe(100);
    expect(dati.multipleOrders, 'I clienti che tornano sono cinquanta, non quelli che stanno nelle prime mille righe').toBe(50);
  }, 60000);
});
