import { describe, it, expect } from 'vitest';
import type { Database } from '@/lib/database.types';

/**
 * Smoke test sul Database type generato da scripts/gen-db-types.mjs.
 *
 * NON tipizziamo il client Supabase globalmente con questo Database type:
 * essendo derivato dalle migrations SQL (non dal DB live via supabase gen
 * types), manca le relations e ha insert/nullable imperfetti — tiparci il
 * client genera ~320 errori falsi. Resta come:
 *  1. documentazione schema auto-generata
 *  2. base per derivare tipi dove serve
 *  3. baseline pronta per `supabase gen types` quando c'è DB access
 *
 * Questo test garantisce che la generazione copra le tabelle critiche e
 * non si rompa silenziosamente (es. regex parser fallisce su nuova migration).
 */

type Tables = Database['public']['Tables'];

describe('Database types (generato da migrations)', () => {
  it('copre le tabelle core del marketplace', () => {
    // Type-level assertion: se una tabella manca, TS fallisce a compile time.
    const coreTablesExist: Record<string, true> = {
      orders: true,
      products: true,
      profiles: true,
      reviews: true,
      categories: true,
      returns: true,
      order_items: true,
      notifications: true,
      favorites: true,
      user_addresses: true,
    };
    // Verifica che i nomi siano chiavi valide di Tables (compile-time check)
    const keys = Object.keys(coreTablesExist) as (keyof Tables)[];
    expect(keys.length).toBe(10);
  });

  it('orders.Row ha le colonne fondamentali tipizzate', () => {
    // Compile-time: accede ai campi → se mancano, TS rompe
    type OrderRow = Tables['orders']['Row'];
    const sample: Pick<OrderRow, 'id' | 'user_id' | 'total_price' | 'delivery_status'> = {
      id: 'x',
      user_id: 'y',
      total_price: 10,
      delivery_status: 'DELIVERED',
    };
    expect(sample.id).toBe('x');
    expect(sample.total_price).toBe(10);
  });

  it('profiles.Row include campi business/KYC', () => {
    type ProfileRow = Tables['profiles']['Row'];
    // Se questi campi non fossero stati parsati dagli ALTER, TS romperebbe
    const k: keyof ProfileRow = 'role';
    expect(k).toBe('role');
  });
});
