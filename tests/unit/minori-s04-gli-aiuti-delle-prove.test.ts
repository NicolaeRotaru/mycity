import { describe, it, expect } from 'vitest';
import { colonneMancanti, databaseCheConosceLeColonne, legame } from './aiuti/database-che-conosce-le-colonne';
import { supabase } from './aiuti/finti/supabase-client.mjs';

/**
 * 5/11/2026 (S04) — Gli aiuti delle prove devono dire il vero, nei due versi: rosso quando il
 * database vero risponderebbe errore, verde quando risponderebbe giusto.
 */
describe('il database che conosce le colonne', () => {
  it('accetta le forme che PostgREST accetta: count, percorsi JSON, aggancio per colonna (1808)', () => {
    expect(colonneMancanti('orders', 'id, items:order_items ( count )')).toEqual([]);
    expect(colonneMancanti('orders', 'id, metadata->>foo')).toEqual(
      colonneMancanti('orders', 'id, metadata'),
    );
    expect(colonneMancanti('orders', 'id, seller:seller_id ( store_name )')).toEqual([]);
  });

  it('un aggancio per colonna controlla le colonne della tabella giusta (1808)', () => {
    expect(colonneMancanti('orders', 'id, seller:seller_id ( colonna_inventata )')).toEqual([
      'profiles.colonna_inventata',
    ]);
  });

  it('una chiave esterna inventata nel suggerimento è rossa, una vera è verde (1807)', () => {
    expect(legame('orders_seller_id_fkey')).toMatchObject({ tabella: 'orders', colonna: 'seller_id', verso: 'profiles' });
    expect(colonneMancanti('orders', 'id, seller:profiles!orders_seller_id_fkey ( store_name )')).toEqual([]);
    expect(colonneMancanti('orders', 'id, seller:profiles!orders_venditore_fkey ( store_name )')).toHaveLength(1);
    // Una chiave vera ma fra altre due tabelle non lega orders a profiles.
    expect(colonneMancanti('orders', 'id, x:profiles!products_seller_id_fkey ( store_name )')).toHaveLength(1);
  });

  it('una colonna sbagliata in un filtro o nell’ordinamento fa rispondere errore (1795)', async () => {
    const db = databaseCheConosceLeColonne({ orders: [] });
    const giusto = await (db.from('orders').select('id').eq('payment_method', 'cod').order('created_at') as unknown as Promise<{ error: unknown }>);
    expect(giusto.error).toBeNull();
    for (const sbagliata of [
      () => db.from('orders').select('id').eq('payment_mode', 'cod'),
      () => db.from('orders').select('id').not('seller_payout', 'is', null),
      () => db.from('orders').select('id').order('creato_il'),
    ]) {
      const r = await (sbagliata() as unknown as Promise<{ error: { code: string } | null }>);
      expect(r.error?.code).toBe('42703');
    }
  });
});

describe('il client Supabase finto delle pagine montate', () => {
  it('il canale finto si concatena come quello vero (2446)', () => {
    const canale = supabase.channel('x') as { on: (...a: unknown[]) => unknown };
    expect(() =>
      (canale.on('postgres_changes', {}, () => {}) as { on: (...a: unknown[]) => { subscribe: () => unknown } })
        .on('postgres_changes', {}, () => {})
        .subscribe(),
    ).not.toThrow();
  });
});
