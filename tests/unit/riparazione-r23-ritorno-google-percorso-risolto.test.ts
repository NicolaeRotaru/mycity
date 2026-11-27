/**
 * R23-006 — Anche il ritorno da Google (/auth/callback) riconosce l'area dal percorso risolto.
 *
 * '/rider/..' porta su '/', '/%73eller/dashboard' su /seller/dashboard: guardando la stringa la regola
 * di ruolo non li riconosceva, e il fattorino finiva sulla home del sito invece che sulla sua.
 * Qui si chiama la rotta vera, con Supabase finto, e si guarda dove rimanda.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

const APP = 'https://mycity.test';

vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test' },
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.test', key: 'chiave-anonima' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

const stato = vi.hoisted(() => ({ ruolo: 'buyer' as string }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tabella: string) {
      const lettura: Record<string, unknown> = {};
      const risposta = async () =>
        tabella === 'profiles'
          ? { data: { role: stato.ruolo, tos_accepted_at: '2026-01-01T00:00:00Z' }, error: null }
          : { data: { versione_testo: 'privacy-2.0+terms-3.0' }, error: null };
      for (const passo of ['select', 'eq', 'order', 'limit']) lettura[passo] = () => lettura;
      lettura.maybeSingle = risposta;
      lettura.single = risposta;
      lettura.insert = async () => ({ error: null });
      lettura.update = () => ({ eq: async () => ({ error: null }) });
      return lettura;
    },
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      async exchangeCodeForSession() {
        return {
          data: {
            user: { id: 'persona-1', created_at: '2026-10-01T10:00:00Z', user_metadata: {}, app_metadata: { provider: 'google' } },
            session: { access_token: 'a', refresh_token: 'r' },
          },
          error: null,
        };
      },
    },
  }),
}));

const { GET: ritorno } = await import('@/app/auth/callback/route');

/** Torna da Google con questo `next`; restituisce il percorso d'arrivo. */
async function tornaDaGoogle(ruolo: string, next: string): Promise<string> {
  stato.ruolo = ruolo;
  const q = new URLSearchParams({ code: 'codice-google', versione: VERSIONE_TESTI_LEGALI, next });
  const res = await ritorno(new NextRequest(`${APP}/auth/callback?${q}`));
  const dove = new URL(res.headers.get('location') ?? '');
  expect(dove.searchParams.get('via'), 'controprova: la sessione si è aperta').toBe('google');
  return dove.pathname;
}

describe('R23-006 — il ritorno da Google guarda il percorso risolto', () => {
  it.each([
    ['rider', '/rider/..', '/rider'],
    ['admin', '/admin/../', '/admin'],
    ['seller', '/.', '/seller/dashboard'],
  ])('%s con ritorno %s (che porta su «/») va sulla sua home', async (ruolo, next, casa) => {
    expect(await tornaDaGoogle(ruolo, next)).toBe(casa);
  });

  it('il fattorino con ritorno «/%73eller/dashboard» va sulla sua home', async () => {
    expect(await tornaDaGoogle('rider', '/%73eller/dashboard')).toBe('/rider');
  });

  it('un ritorno nell\'area del proprio ruolo resta', async () => {
    expect(await tornaDaGoogle('seller', '/%73eller/products')).toBe('/%73eller/products');
  });
});
