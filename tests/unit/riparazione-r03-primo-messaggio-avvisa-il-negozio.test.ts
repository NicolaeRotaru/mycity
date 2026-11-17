import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-006 — Il primo messaggio mandato insieme all'apertura della conversazione
 * (POST /api/chat/conversations con `firstMessage`) si inseriva direttamente: niente campanella e
 * niente email al negozio, a differenza di un messaggio mandato dalla chat. Adesso deve dare lo
 * stesso avviso della rotta dei messaggi normali.
 *
 * La rotta vera con il database finto; `avvisaNegozioMessaggioNuovo` (l'email) è finta e conta le
 * chiamate, la campanella si legge dalle righe scritte in `notifications`.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato = vi.hoisted(() => ({
  messaggi: [] as Array<Record<string, unknown>>,
  notifiche: [] as Array<Record<string, unknown>>,
  esistente: null as null | { id: string },
}));

const avviso = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/avviso-messaggio-negozio', () => ({ avvisaNegozioMessaggioNuovo: avviso }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: BUYER }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, remaining: 19, retryAfterSec: 0, limit: 20 }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
}));
vi.mock('@/lib/supabase/server', () => {
  /** Una lettura che accetta filtri a catena e chiude con `maybeSingle`. */
  const lettura = (riga: () => unknown) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: riga(), error: null });
    return q;
  };
  const utente = {
    from: (tabella: string) => {
      if (tabella === 'seller_public_profiles') return lettura(() => ({ id: SELLER }));
      if (tabella === 'conversations') {
        return {
          ...lettura(() => stato.esistente),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: CONV }, error: null }) }) }),
        };
      }
      if (tabella === 'messages') {
        return {
          insert: (riga: Record<string, unknown>) => {
            stato.messaggi.push(riga);
            const esito = { data: { id: 'm-1', created_at: '2026-11-17T10:00:00Z' }, error: null };
            return {
              select: () => ({ single: async () => esito }),
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(ok, ko),
            };
          },
        };
      }
      throw new Error(`tabella inattesa ${tabella}`);
    },
  };
  const admin = {
    from: (tabella: string) => {
      if (tabella === 'conversations') {
        // Il trigger del database ha appena portato a 1 i non letti del negozio.
        return lettura(() => ({ buyer_id: BUYER, seller_id: SELLER, buyer_unread_count: 0, seller_unread_count: 1 }));
      }
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: [{ id: BUYER, role: 'buyer' }, { id: SELLER, role: 'seller' }], error: null }) }) };
      }
      if (tabella === 'notifications') {
        const l: Record<string, unknown> = {};
        l.eq = () => l;
        l.limit = async () => ({ data: [], error: null });
        return {
          select: () => l,
          insert: async (riga: Record<string, unknown>) => {
            stato.notifiche.push(riga);
            return { error: null };
          },
        };
      }
      throw new Error(`tabella inattesa (admin) ${tabella}`);
    },
  };
  return { getServerSupabase: async () => utente, getAdminSupabase: () => admin };
});

const { POST } = await import('@/app/api/chat/conversations/route');

const apri = (corpo: Record<string, unknown>) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );

/** Il lavoro «dopo la risposta», fuori da un server, parte senza essere atteso: si lascia girare. */
const lasciaGirare = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  stato.messaggi = [];
  stato.notifiche = [];
  stato.esistente = null;
  avviso.mockReset();
  avviso.mockResolvedValue({ inviato: true });
});

describe('R03-006 — il primo messaggio con l’apertura della conversazione avvisa il negozio', () => {
  it('conversazione nuova con firstMessage: messaggio salvato, campanella al negozio ed email', async () => {
    const r = await apri({ sellerId: SELLER, firstMessage: 'Avete il pane senza glutine?' });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ conversationId: CONV });
    expect(stato.messaggi).toEqual([{ conversation_id: CONV, sender_id: BUYER, body: 'Avete il pane senza glutine?' }]);
    expect(stato.notifiche, 'nessuna campanella al negozio per il primo messaggio').toHaveLength(1);
    expect(stato.notifiche[0]).toMatchObject({
      user_id: SELLER,
      title: 'Nuovo messaggio da un cliente',
      body: 'Avete il pane senza glutine?',
      link: `/messages/${CONV}`,
    });
    expect(avviso, 'il negozio non riceve nessuna email per il primo messaggio').toHaveBeenCalledTimes(1);
    expect(avviso.mock.calls[0][1]).toEqual({ conversationId: CONV, senderId: BUYER });
  });

  it('conversazione già aperta con firstMessage: lo stesso avviso', async () => {
    stato.esistente = { id: CONV };
    const r = await apri({ sellerId: SELLER, firstMessage: 'Ci sono ancora le brioche?' });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.messaggi).toHaveLength(1);
    expect(stato.notifiche).toHaveLength(1);
    expect(avviso).toHaveBeenCalledTimes(1);
  });

  it('controprova: senza firstMessage nessun messaggio e nessun avviso', async () => {
    const r = await apri({ sellerId: SELLER });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.messaggi).toEqual([]);
    expect(stato.notifiche).toEqual([]);
    expect(avviso).not.toHaveBeenCalled();
  });
});
