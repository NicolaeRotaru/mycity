/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { quantiOrdini, avvisoOrdiniOltreIlTetto, TETTO_ORDINI } from '@/lib/ordini/tetto-ordini';

/**
 * R10-013 — «I miei ordini» legge al massimo 100 ordini. L'intestazione diceva
 * «100 ordini» e gli ordini più vecchi sparivano senza un avviso. Qui si monta
 * la pagina VERA con 100 ordini finti.
 */

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

const ordine = (i: number) => ({
  id: `ordine-${i}`, total_price: 10, payment_status: 'PAID', delivery_status: 'DELIVERED',
  created_at: new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString(), seller_id: 'negozio-1',
  seller: { store_name: 'Forno', store_logo: null }, order_items: [],
});

async function pagina(n: number): Promise<string> {
  const Ordini = (await monta('app/orders/page.tsx')).default as Pagina;
  g.__UTENTE__ = { id: 'luca-1', email: 'luca@example.it' };
  g.__DATI_QUERY__ = () => Array.from({ length: n }, (_, i) => ordine(i));
  const s = accendi(Ordini);
  const limite = Date.now() + 4000;
  while (Date.now() < limite && !/I tuoi ordini/.test(testoVisibile(s.radice))) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  const t = testoVisibile(s.radice);
  s.smonta();
  return t;
}

describe('R10-013 — dopo il centesimo ordine la pagina lo dice', () => {
  it('con 100 ordini: «ultimi 100 ordini» e un avviso per i più vecchi', async () => {
    const t = await pagina(TETTO_ORDINI);
    expect(t, 'la pagina dice «100 ordini» come se fossero tutti').toMatch(/ultimi 100 ordini/);
    expect(t).toMatch(/Qui vedi solo gli ultimi 100 ordini/);
  }, 120000);

  it('con 12 ordini: niente avviso', async () => {
    const t = await pagina(12);
    expect(t).toMatch(/12 ordini/);
    expect(t).not.toMatch(/Qui vedi solo/);
  }, 120000);

  it('le parole', () => {
    expect(quantiOrdini(1)).toBe('1 ordine');
    expect(quantiOrdini(99)).toBe('99 ordini');
    expect(quantiOrdini(100)).toBe('ultimi 100 ordini');
    expect(avvisoOrdiniOltreIlTetto(99)).toBeNull();
  });
});
