import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Estensione dei test RLS: un client ANONIMO non deve poter leggere le tabelle
 * che contengono dati privati/sensibili. Complementa rls-policies.test.ts
 * (profiles/orders) allargando la copertura.
 *
 * Asserzione robusta: per ogni tabella va bene SIA un errore (RLS che nega)
 * SIA zero righe (RLS che filtra silenziosamente) — entrambi significano che
 * anon non accede ai dati. Fallisce solo se anon riesce a leggere righe.
 *
 * Solo SELECT: nessuna mutazione. Si salta senza env Supabase.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasEnv = !!(URL && ANON);

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
