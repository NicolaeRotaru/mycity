import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Test d'INTEGRAZIONE (richiede un DB Supabase reale): un client ANONIMO non
 * deve poter leggere le tabelle con dati privati/sensibili.
 *
 * Asserzione robusta: per ogni tabella va bene SIA un errore (RLS che nega) SIA
 * zero righe (RLS che filtra silenziosamente) — entrambi significano che anon
 * non accede ai dati. Fallisce solo se anon riesce a leggere righe.
 *
 * Solo SELECT: nessuna mutazione. Si salta senza env Supabase reali.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Salta anche sui placeholder del build CI, per non dare falsi verdi.
const hasEnv = !!(URL && ANON) && !URL.includes('placeholder') && !ANON.includes('placeholder');

// Tabelle che NON devono mai esporre righe a un anonimo.
const PRIVATE_TABLES = [
  'disputes',
  'notifications',
  'audit_logs',
  'stripe_event_log',
  'rider_sos_events',
  'user_addresses',
  'loyalty_transactions',
  'email_queue',
  'messages',
  'order_items',
  'push_subscriptions',
  'contact_messages',
];

describe.skipIf(!hasEnv)('RLS: anon non legge tabelle private', () => {
  let anon: SupabaseClient;
  beforeAll(() => {
    anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
  });

  for (const table of PRIVATE_TABLES) {
    it(`anon NON legge righe da ${table}`, async () => {
      const { data, error } = await anon.from(table).select('*').limit(1);
      const denied = error !== null || (data ?? []).length === 0;
      expect(denied, `${table}: anon ha letto ${(data ?? []).length} righe`).toBe(true);
    });
  }
});
