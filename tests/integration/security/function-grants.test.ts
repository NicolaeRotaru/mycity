import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Test d'INTEGRAZIONE (richiede un DB Supabase reale) sui grant EXECUTE delle
 * funzioni SECURITY DEFINER.
 *
 * Contesto: piu' volte alcune RPC `SECURITY DEFINER` sono rimaste chiamabili da
 * `anon` via PostgREST (/rest/v1/rpc/...), bypassando l'auth. Questo test blinda
 * il confine: un client ANONIMO non deve poter invocare nessuna di queste.
 * Avrebbe intercettato la regressione in cui la migration 067 non era applicata
 * (anon poteva eseguire verify_*_code / cancel_order / ...).
 *
 * Modello corretto dei permessi:
 *   - cancel_order, seller_reject_order, rider_release_order, verify_pickup_code,
 *     verify_delivery_code  -> invocate CLIENT-SIDE come `authenticated`
 *     (con check interno auth.uid()): anon NO, authenticated SI.
 *   - reserve_stock, restore_stock, restore_stock_for_order -> server-only
 *     (service_role): anon NO, authenticated NO.
 * In tutti i casi `anon` deve essere NEGATO: e' questo che il test verifica.
 *
 * Si salta se mancano le env Supabase reali (dev locale / placeholder CI). NON
 * muta dati: usa argomenti no-op e un anon bloccato fallisce PRIMA di eseguire.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Salta anche sui placeholder del build CI, per non dare falsi verdi.
const hasEnv = !!(URL && ANON) && !URL.includes('placeholder') && !ANON.includes('placeholder');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Funzioni che `anon` non deve MAI poter invocare (permesso negato / non esposta).
const ANON_DENIED_RPCS: Array<{ fn: string; args: Record<string, unknown> }> = [
  { fn: 'cancel_order',            args: { p_order_id: ZERO_UUID } },
  { fn: 'seller_reject_order',     args: { p_order_id: ZERO_UUID } },
  { fn: 'rider_release_order',     args: { p_order_id: ZERO_UUID } },
  { fn: 'verify_pickup_code',      args: { p_order_id: ZERO_UUID, p_code: '000000' } },
  { fn: 'verify_delivery_code',    args: { p_order_id: ZERO_UUID, p_code: '000000' } },
  { fn: 'reserve_stock',           args: { p_items: [] } },
  { fn: 'restore_stock',           args: { p_items: [] } },
  { fn: 'restore_stock_for_order', args: { p_order_id: ZERO_UUID } },
];

describe.skipIf(!hasEnv)('EXECUTE lockdown su SECURITY DEFINER (anon negato)', () => {
  let anon: SupabaseClient;
  beforeAll(() => {
    anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
  });

  for (const { fn, args } of ANON_DENIED_RPCS) {
    it(`anon NON puo eseguire ${fn}()`, async () => {
      const { error } = await anon.rpc(fn, args);
      // Atteso: errore (permesso negato / funzione non esposta a anon). Se questo
      // fallisce, una RPC e' di nuovo chiamabile senza login: regressione (es.
      // migration di lockdown non applicata al DB).
      expect(error, `${fn} dovrebbe essere negata ad anon`).not.toBeNull();
    });
  }
});
