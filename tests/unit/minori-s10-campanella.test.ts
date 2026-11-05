import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S10 (5/11/2026) — la campanella della chat: due messaggi quasi insieme
 * (2640) e il titolo nella chat con l'Assistenza (2641).
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato: {
  utente: { id: string };
  conv: Record<string, unknown>;
  notifiche: Array<Record<string, unknown>>;
  erroreNotifica: { message: string } | null;
  ruoli: Array<{ id: string; role: string }>;
} = { utente: { id: BUYER }, conv: {}, notifiche: [], erroreNotifica: null, ruoli: [] };

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
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'm-1', created_at: '2026-11-01T10:00:00Z' }, error: null }) }) }),
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
        // S10 (5/11/2026) — la rotta guarda se c'e' gia' una voce non letta per la
        // conversazione (prima guardava il contatore riletto dopo l'invio).
        const filtri: Record<string, unknown> = {};
        const lettura = {
          eq: (c: string, v: unknown) => {
            filtri[c] = v;
            return lettura;
          },
          limit: async () => ({
            data: stato.notifiche.filter(
              (n) => n.user_id === filtri.user_id && n.link === filtri.link && (n.is_read ?? false) === filtri.is_read,
            ),
            error: null,
          }),
        };
        return {
          select: () => lettura,
          insert: async (riga: Record<string, unknown>) => {
            if (stato.erroreNotifica) return { error: stato.erroreNotifica };
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

beforeEach(() => {
  stato.utente = { id: BUYER };
  stato.conv = { buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 1 };
  stato.notifiche = [];
  stato.erroreNotifica = null;
  stato.ruoli = [];
});

describe('due messaggi quasi insieme accendono la campanella (2640)', () => {
  it('col contatore già a 2 per tutte e due le richieste, la campanella si scrive almeno una volta', async () => {
    stato.conv = { ...stato.conv, seller_unread_count: 2 };
    await Promise.all([invia('Primo'), invia('Secondo')]);
    expect(stato.notifiche.length).toBeGreaterThanOrEqual(1);
  });
});

describe('nella chat con l\'Assistenza il titolo non parla di clienti e negozi (2641)', () => {
  it('scrive l\'Assistenza → «L’Assistenza MyCity ti ha risposto»', async () => {
    stato.utente = { id: SELLER };
    stato.conv = { buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 1, seller_unread_count: 0 };
    stato.ruoli = [{ id: SELLER, role: 'admin' }, { id: BUYER, role: 'seller' }];
    await invia('Ciao, come possiamo aiutarti?');
    expect(stato.notifiche[0].title).toBe('L’Assistenza MyCity ti ha risposto');
  });
  it('scrive chi chiede aiuto → «Nuovo messaggio per l’Assistenza»', async () => {
    stato.ruoli = [{ id: SELLER, role: 'admin' }, { id: BUYER, role: 'seller' }];
    await invia('Non riesco a caricare le foto');
    expect(stato.notifiche[0].title).toBe('Nuovo messaggio per l’Assistenza');
  });
  it('cliente e negozio veri: come prima', async () => {
    stato.ruoli = [{ id: SELLER, role: 'seller' }, { id: BUYER, role: 'buyer' }];
    await invia('Avete il pane?');
    expect(stato.notifiche[0].title).toBe('Nuovo messaggio da un cliente');
  });
});
