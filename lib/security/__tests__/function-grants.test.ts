import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Test di regressione sui grant EXECUTE delle funzioni SECURITY DEFINER.
 *
 * Contesto: piu' volte alcune RPC `SECURITY DEFINER` sono rimaste chiamabili
 * da `anon` via PostgREST (/rest/v1/rpc/...), bypassando l'auth delle route
 * server (vedi migration 064 e 067). Questo test blinda quel confine: un
 * client ANONIMO non deve poter invocare le funzioni server-only. Avrebbe
 * intercettato in CI la regressione chiusa da 067.
 *
 * Si salta se mancano le env Supabase (dev locale), gira in CI dove i secret
 * ci sono. NON muta dati: passa argomenti no-op (UUID inesistente / array
 * vuoto), e comunque un anon correttamente bloccato fallisce PRIMA di eseguire.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasEnv = !!(URL && ANON);

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Funzioni server-only: SOLO service_role (route server) deve poterle chiamare.
// anon deve ricevere un errore (permesso negato / non esposta).
const SERVER_ONLY_RPCS: Array<{ fn: string; args: Record<string, unknown> }> = [
  { fn: 'verify_pickup_code',     args: { p_order_id: ZERO_UUID, p_code: '000000' } },
  { fn: 'verify_delivery_code',   args: { p_order_id: ZERO_UUID, p_code: '000000' } },
  { fn: 'seller_reject_order',    args: { p_order_id: ZERO_UUID } },
  { fn: 'rider_release_order',    args: { p_order_id: ZERO_UUID } },
  { fn: 'reserve_stock',          args: { p_items: [] } },
  { fn: 'restore_stock',          args: { p_items: [] } },
  { fn: 'restore_stock_for_order', args: { p_order_id: ZERO_UUID } },
  // cancel_order: consentita ad authenticated (proprietario), MAI ad anon.
  { fn: 'cancel_order',           args: { p_order_id: ZERO_UUID } },
];

describe.skipIf(!hasEnv)('EXECUTE lockdown su SECURITY DEFINER (anon)', () => {
  let anon: SupabaseClient;
  beforeAll(() => {
    anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
  });

  for (const { fn, args } of SERVER_ONLY_RPCS) {
    it(`anon NON puo eseguire ${fn}()`, async () => {
      const { error } = await anon.rpc(fn, args);
      // Atteso: errore (permesso negato / funzione non esposta a anon).
      // Se questo fallisce, una RPC server-only e' di nuovo chiamabile da
      // chiunque senza login: regressione di sicurezza.
      expect(error, `${fn} dovrebbe essere negata ad anon`).not.toBeNull();
    });
  }
});
