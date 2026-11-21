import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-004 — SE LA LETTURA DEI RUOLI CADEVA, ALL'ASSISTENZA ARRIVAVA L'EMAIL «UN CLIENTE TI HA SCRITTO».
 *
 * La rotta decide se mandare l'email pensata per un negozio guardando i ruoli di chi scrive e di
 * chi riceve. Se quella lettura cadeva, i ruoli risultavano vuoti, «nessuno dei due è admin», e
 * l'email da negozio partiva anche verso l'account dell'Assistenza. Adesso, ruoli non letti →
 * niente email da negozio (non si sa chi riceve); la campanella resta e il messaggio è inviato.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const ASSISTENZA = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato: {
  ruoli: { data: unknown; error: unknown };
  notifiche: Array<Record<string, unknown>>;
} = { ruoli: { data: null, error: null }, notifiche: [] };

const avviso = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/avviso-messaggio-negozio', () => ({ avvisaNegozioMessaggioNuovo: avviso }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: BUYER }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, remaining: 29, retryAfterSec: 0, limit: 30 }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'm-1', created_at: '2026-11-21T10:00:00Z' }, error: null }) }) }),
    }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { buyer_id: BUYER, seller_id: ASSISTENZA, buyer_unread_count: 0, seller_unread_count: 1 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (tabella === 'profiles') return { select: () => ({ in: async () => stato.ruoli }) };
      if (tabella === 'notifications') {
        const lettura = { eq: () => lettura, limit: async () => ({ data: [], error: null }) };
        return {
          select: () => lettura,
          insert: async (riga: Record<string, unknown>) => {
            stato.notifiche.push(riga);
            return { error: null };
          },
        };
      }
      throw new Error(`tabella inattesa ${tabella}`);
    },
  }),
}));

import { POST } from '@/app/api/chat/messages/route';

const invia = (body: string) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: CONV, body }),
    }),
  );

/** Il lavoro «dopo la risposta», fuori da un server, parte senza essere atteso: si lascia girare. */
const lasciaGirare = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  stato.ruoli = { data: null, error: null };
  stato.notifiche = [];
  avviso.mockReset();
  avviso.mockResolvedValue({ inviato: true });
});

describe('R03-004 · ruoli non letti: niente email da negozio', () => {
  it('lettura dei ruoli caduta → nessuna email «un cliente ti ha scritto», ma messaggio inviato e campanella scritta', async () => {
    stato.ruoli = { data: null, error: { message: 'connessione persa', code: '08006' } };
    const r = await invia('Non trovo il mio ordine');
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(avviso, 'con i ruoli non letti è partita l’email pensata per un negozio').not.toHaveBeenCalled();
    expect(stato.notifiche).toHaveLength(1);
  });

  it('controprova: ruoli letti, chi riceve è un negozio → l’email parte come prima', async () => {
    stato.ruoli = { data: [{ id: BUYER, role: 'buyer' }, { id: ASSISTENZA, role: 'seller' }], error: null };
    await invia('Avete il pane senza glutine?');
    await lasciaGirare();
    expect(avviso).toHaveBeenCalledTimes(1);
  });
});
