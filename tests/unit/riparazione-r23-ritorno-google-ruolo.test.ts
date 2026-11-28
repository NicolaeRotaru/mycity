/**
 * R23-004 — Dopo l'accesso con Google il ritorno applica la regola di ruolo.
 *
 * Con email e password (app/sign-in/page.tsx) amministratore, negozio e fattorino vanno sulla home
 * del proprio ruolo se il ritorno è '/' o sta nell'area di un altro ruolo. Il ritorno da Google passa
 * da /auth/callback, che mandava sempre su `next`: un fattorino con ritorno /seller (la sessione del
 * negozio scaduta sullo stesso dispositivo) finiva su /seller e il portiere lo rimandava su '/'.
 * Qui si chiama la rotta vera, con Supabase finto, e si guarda dove rimanda.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const stato = vi.hoisted(() => ({ ruolo: 'buyer' as string | null, muto: false }));

/** Il database finto: il profilo col ruolo, e il verbale con i testi in vigore già accettati. */
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tabella: string) {
      const lettura: Record<string, unknown> = {};
      const risposta = async () => {
        if (stato.muto) return new Promise(() => {});
        if (tabella === 'profiles') return { data: stato.ruolo === null ? null : { role: stato.ruolo, tos_accepted_at: '2026-01-01T00:00:00Z' }, error: null };
        return { data: { versione_testo: 'privacy-2.0+terms-3.0' }, error: null };
      };
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
  createServerClient: (_u: string, _k: string, { cookies }: { cookies: { set(n: string, v: string, o: Record<string, unknown>): void } }) => ({
    auth: {
      async exchangeCodeForSession() {
        cookies.set('sb-progetto-auth-token', 'sessione', { path: '/' });
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

/** Torna da Google con questo `next` (o senza), come fa il pulsante; restituisce percorso e query d'arrivo. */
async function tornaDaGoogle(ruolo: string | null, next?: string): Promise<string> {
  stato.ruolo = ruolo;
  const q = new URLSearchParams({ code: 'codice-google', versione: VERSIONE_TESTI_LEGALI });
  if (next !== undefined) q.set('next', next);
  const res = await ritorno(new NextRequest(`${APP}/auth/callback?${q}`));
  const dove = new URL(res.headers.get('location') ?? '');
  expect(dove.origin).toBe(APP);
  expect(dove.searchParams.get('via'), 'controprova: la sessione si è aperta').toBe('google');
  dove.searchParams.delete('auth');
  dove.searchParams.delete('via');
  return `${dove.pathname}${dove.search}`;
}

beforeEach(() => { stato.muto = false; });

describe('R23-004 — il ritorno da Google applica la regola di ruolo', () => {
  it('IL CASO DELLA VOCE — il fattorino con ritorno /seller va sulla sua home, non nell\'area del negozio', async () => {
    expect(await tornaDaGoogle('rider', '/seller')).toBe('/rider');
  });

  it('il negozio con ritorno nell\'area amministratore va sulla sua dashboard', async () => {
    expect(await tornaDaGoogle('seller', '/admin/utenti')).toBe('/seller/dashboard');
  });

  it.each([
    ['admin', '/admin'],
    ['seller', '/seller/dashboard'],
    ['rider', '/rider'],
  ])('senza ritorno (o con «/?x») %s va sulla sua home (%s)', async (ruolo, casa) => {
    expect(await tornaDaGoogle(ruolo)).toBe(casa);
    expect(await tornaDaGoogle(ruolo, '/?x=1')).toBe(casa);
  });

  it('un ritorno valido resta: /accetta-condizioni per tutti, l\'area del proprio ruolo per il negozio', async () => {
    expect(await tornaDaGoogle('rider', '/accetta-condizioni?next=/checkout')).toBe('/accetta-condizioni?next=%2Fcheckout');
    expect(await tornaDaGoogle('seller', '/seller/products')).toBe('/seller/products');
  });

  // 28/11/2026 — Nicola: «hai reso l'admin un venditore». L'amministratore atterra sempre sul suo pannello.
  it('l\'amministratore con ritorno nell\'area negozio o fattorino atterra su /admin', async () => {
    expect(await tornaDaGoogle('admin', '/seller/dashboard')).toBe('/admin');
    expect(await tornaDaGoogle('admin', '/seller/orders')).toBe('/admin');
    expect(await tornaDaGoogle('admin', '/rider')).toBe('/admin');
    expect(await tornaDaGoogle('admin', '/admin/utenti')).toBe('/admin/utenti');
  });

  it('il cliente non cambia: va dove dice il ritorno, anche verso /seller o «/»', async () => {
    expect(await tornaDaGoogle('buyer', '/seller')).toBe('/seller');
    expect(await tornaDaGoogle('buyer')).toBe('/');
    expect(await tornaDaGoogle(null, '/checkout')).toBe('/checkout');
  });

  it('col database muto si entra lo stesso, entro il tetto, verso il ritorno', async () => {
    stato.muto = true;
    const partenza = Date.now();
    expect(await tornaDaGoogle('rider', '/checkout')).toBe('/checkout');
    expect(Date.now() - partenza).toBeLessThan(4000);
  }, 10000);
});
