import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R05-002 — GET /api/admin/contanti-da-stripe: da quando i contanti li paga Stripe.
 *
 * Il pannello dei bonifici la chiede per togliere dal lunedì i contanti che paga il giro. Dice solo
 * l'istante di `inizioContantiDaStripe()` (o `null`), e solo a un amministratore: chi non è admin,
 * o non è collegato, è rifiutato e non riceve niente. Il ruolo lo legge il controllo vero
 * (withAdminAuth), dal profilo nel database finto.
 */

const chi = vi.hoisted(() => ({ utente: { id: 'u-1' } as { id: string } | null, ruolo: 'admin' }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => chi.utente,
  getServerSupabase: async () => ({}),
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: chi.utente?.id, role: chi.ruolo, is_approved: true }, error: null }) }) }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));

import { GET } from '@/app/api/admin/contanti-da-stripe/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = () => GET(new NextRequest('https://mycity.test/api/admin/contanti-da-stripe'));

beforeEach(() => {
  chi.utente = { id: 'u-1' };
  chi.ruolo = 'admin';
  __resetRateLimitBuckets();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('R05-002 — la rotta dei contanti pagati da Stripe', () => {
  it('admin: riceve l’istante della mezzanotte di Piacenza del giorno scritto', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-11-16');
    const r = await chiedi();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, data: { dal: Date.parse('2026-11-15T23:00:00Z') } });
  });

  it('admin: variabile vuota o storta → null (i contanti li versa Nicola)', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '');
    expect(await (await chiedi()).json()).toEqual({ ok: true, data: { dal: null } });
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '16/11/2026');
    expect(await (await chiedi()).json()).toEqual({ ok: true, data: { dal: null } });
  });

  it.each(['seller', 'buyer', 'rider'])('%s: rifiutato (403), e la risposta non dice il giorno', async (ruolo) => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-11-16');
    chi.ruolo = ruolo;
    const r = await chiedi();
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).not.toContain(String(Date.parse('2026-11-15T23:00:00Z')));
  });

  it('nessuno collegato: rifiutato (401)', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-11-16');
    chi.utente = null;
    const r = await chiedi();
    expect(r.status).toBe(401);
    expect(JSON.stringify(await r.json())).not.toContain('"dal"');
  });
});
