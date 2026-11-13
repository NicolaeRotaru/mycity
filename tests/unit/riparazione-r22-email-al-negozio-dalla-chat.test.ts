import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R22-010 — Quando un cliente scrive al negozio, parte l'email al negozio.
 *
 * La rotta vera (POST /api/chat/messages) con il database finto; `avvisaNegozioMessaggioNuovo`
 * è finta e conta le chiamate (le sue regole — una per giro di non letti, niente se il negozio è
 * in chat — hanno la loro prova in il-negozio-sa-che-un-cliente-gli-ha-scritto.test.ts).
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato: {
  utente: { id: string };
  conv: Record<string, unknown>;
  ruoli: Array<{ id: string; role: string }>;
  notifiche: Array<Record<string, unknown>>;
} = { utente: { id: BUYER }, conv: {}, ruoli: [], notifiche: [] };

const avviso = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/avviso-messaggio-negozio', () => ({ avvisaNegozioMessaggioNuovo: avviso }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: stato.utente, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, remaining: 29, retryAfterSec: 0, limit: 30 }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'm-1', created_at: '2026-11-13T10:00:00Z' }, error: null }) }) }),
    }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'conversations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.conv, error: null }) }) }) };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: stato.ruoli, error: null }) }) };
      }
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
  stato.utente = { id: BUYER };
  stato.conv = { buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 1 };
  stato.ruoli = [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'seller' }];
  stato.notifiche = [];
  avviso.mockReset();
  avviso.mockResolvedValue({ inviato: true });
});

describe('l\'email al negozio quando un cliente gli scrive', () => {
  it('scrive il cliente → parte l\'avviso email al negozio, per quella conversazione', async () => {
    const r = await invia('Avete il pane senza glutine?');
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(avviso, 'il negozio non riceve nessuna email').toHaveBeenCalledTimes(1);
    expect(avviso.mock.calls[0][1]).toEqual({ conversationId: CONV, senderId: BUYER });
  });

  it('scrive il negozio → nessuna email al negozio', async () => {
    stato.utente = { id: SELLER };
    stato.conv = { ...stato.conv, buyer_unread_count: 1, seller_unread_count: 0 };
    await invia('Sì, da domani mattina');
    await lasciaGirare();
    expect(avviso).not.toHaveBeenCalled();
  });

  it('se l\'email cade, il messaggio resta inviato e la campanella c\'è', async () => {
    avviso.mockRejectedValue(new Error('posta giù'));
    const r = await invia('Ciao');
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.notifiche).toHaveLength(1);
  });

  it('controprova: nella chat con l\'Assistenza non parte l\'email «messaggio da un cliente»', async () => {
    stato.ruoli = [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'admin' }];
    await invia('Non trovo il mio ordine');
    await lasciaGirare();
    expect(avviso).not.toHaveBeenCalled();
  });
});
