import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 1/11/2026 — IL CLIENTE SCRIVEVA AL NEGOZIO, IL NEGOZIO NON LO SAPEVA.
 *
 * «Contatta il negozio» sulla scheda prodotto apre una chat; POST /api/chat/messages
 * salvava il messaggio e basta. Il trigger del database (migrations/026) alza solo
 * seller_unread_count: nessuna email, nessuna push, nessuna voce nella campanella.
 * Il negoziante non aveva modo di accorgersene.
 *
 * Qui il database è finto: il messaggio si salva, la conversazione dice chi è il
 * negozio e quanti non letti ha. Atteso: una notifica in-app per il negozio, una
 * sola per giro di non letti, e nessun errore verso il cliente se la notifica non
 * si scrive (il messaggio è già salvato).
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato: {
  utente: { id: string };
  conv: Record<string, unknown>;
  notifiche: Array<Record<string, unknown>>;
  erroreNotifica: { message: string } | null;
} = { utente: { id: BUYER }, conv: {}, notifiche: [], erroreNotifica: null };

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
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
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
});

describe('il negozio sa quando un cliente gli scrive', () => {
  it('il cliente scrive → il negozio trova una notifica che porta alla conversazione', async () => {
    const r = await invia('Avete ancora il pane di segale?');
    expect(r.status).toBe(200);
    expect(stato.notifiche).toHaveLength(1);
    expect(stato.notifiche[0].user_id).toBe(SELLER);
    expect(String(stato.notifiche[0].link)).toContain(CONV);
  });

  it('il secondo messaggio non letto non ripete la campanella', async () => {
    stato.conv = { ...stato.conv, seller_unread_count: 2 };
    await invia('Avete ancora il pane di segale?');
    await invia('Ci siete?');
    expect(stato.notifiche).toHaveLength(1);
  });

  it('se la notifica non si scrive, il messaggio resta inviato', async () => {
    stato.erroreNotifica = { message: 'db giù' };
    const r = await invia('Ciao');
    expect(r.status).toBe(200);
  });
});
