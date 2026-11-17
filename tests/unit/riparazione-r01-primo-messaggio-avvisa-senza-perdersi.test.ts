import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il primo messaggio mandato insieme all'apertura della conversazione (POST
 * /api/chat/conversations con `firstMessage`) si inseriva direttamente: niente campanella e niente
 * email al negozio, a differenza di un messaggio mandato dalla chat. Adesso passa dalla rotta dei
 * messaggi normali, che salva e avvisa una volta sola.
 *
 * E non si perde dove prima si salvava: se la rotta dei messaggi dice di no PRIMA di salvare (il
 * suo freno, la seconda autenticazione caduta o non disponibile — 401, 429, 503 — o un'eccezione),
 * il messaggio si salva come prima, con l'inserimento diretto. Un rifiuto di permesso (403, anche
 * un account sospeso nel frattempo) non si aggira.
 *
 * La rotta vera, e dentro la rotta dei messaggi vera, col database finto; l'email è finta e conta
 * le chiamate, la campanella si legge dalle righe scritte in `notifications`.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const stato = vi.hoisted(() => ({
  messaggi: [] as Array<Record<string, unknown>>,
  notifiche: [] as Array<Record<string, unknown>>,
  /** Come risponde la seconda autenticazione, quella della rotta dei messaggi (null = passa). */
  secondaAutenticazione: null as null | number | 'eccezione',
  frenoMessaggiPieno: false,
  /** Il database rifiuta l'inserimento del messaggio con una regola per riga. */
  inserimentoRifiutato: false,
}));

const avviso = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/avviso-messaggio-negozio', () => ({ avvisaNegozioMessaggioNuovo: avviso }));
vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    async (req: Request) => {
      if (new URL(req.url).pathname === '/api/chat/messages' && stato.secondaAutenticazione !== null) {
        if (stato.secondaAutenticazione === 'eccezione') throw new Error('auth giù');
        return new Response(JSON.stringify({ error: 'no' }), { status: stato.secondaAutenticazione });
      }
      return handler({ user: { id: BUYER }, req });
    },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async ({ key }: { key: string }) =>
    stato.frenoMessaggiPieno && key.startsWith('chat:msg:')
      ? { allowed: false, remaining: 0, retryAfterSec: 30, limit: 30 }
      : { allowed: true, remaining: 19, retryAfterSec: 0, limit: 20 },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
}));
vi.mock('@/lib/supabase/server', () => {
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
          ...lettura(() => null),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: CONV }, error: null }) }) }),
        };
      }
      if (tabella === 'messages') {
        return {
          insert: (riga: Record<string, unknown>) => {
            const rifiuto = { code: '42501', message: 'new row violates row-level security policy' };
            if (!stato.inserimentoRifiutato) stato.messaggi.push(riga);
            const esito = stato.inserimentoRifiutato
              ? { data: null, error: rifiuto }
              : { data: { id: 'm-1', created_at: '2026-11-17T10:00:00Z' }, error: null };
            return {
              select: () => ({ single: async () => esito }),
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
                Promise.resolve({ error: esito.error }).then(ok, ko),
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
          insert: async (riga: Record<string, unknown>) => { stato.notifiche.push(riga); return { error: null }; },
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
const TESTO = 'Avete il pane senza glutine?';
const SALVATO = { conversation_id: CONV, sender_id: BUYER, body: TESTO };

beforeEach(() => {
  stato.messaggi = [];
  stato.notifiche = [];
  stato.secondaAutenticazione = null;
  stato.frenoMessaggiPieno = false;
  stato.inserimentoRifiutato = false;
  avviso.mockReset();
  avviso.mockResolvedValue({ inviato: true });
});

describe('il primo messaggio con l’apertura della conversazione avvisa il negozio', () => {
  it('messaggio salvato una volta, campanella al negozio una volta, email una volta', async () => {
    const r = await apri({ sellerId: SELLER, firstMessage: TESTO });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ conversationId: CONV });
    expect(stato.messaggi).toEqual([SALVATO]);
    expect(stato.notifiche, 'nessuna campanella al negozio per il primo messaggio').toHaveLength(1);
    expect(stato.notifiche[0]).toMatchObject({ user_id: SELLER, link: `/messages/${CONV}` });
    expect(avviso, 'nessuna email al negozio per il primo messaggio').toHaveBeenCalledTimes(1);
  });

  it('senza firstMessage non si salva niente e non si avvisa nessuno', async () => {
    const r = await apri({ sellerId: SELLER });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.messaggi).toEqual([]);
    expect(stato.notifiche).toEqual([]);
    expect(avviso).not.toHaveBeenCalled();
  });
});

describe('il primo messaggio non si perde dove prima si salvava', () => {
  for (const [caso, prepara] of [
    ['la seconda autenticazione risponde 503', () => { stato.secondaAutenticazione = 503; }],
    ['la seconda autenticazione risponde 401', () => { stato.secondaAutenticazione = 401; }],
    ['il freno dei messaggi risponde 429', () => { stato.frenoMessaggiPieno = true; }],
    ['la rotta dei messaggi lancia un’eccezione', () => { stato.secondaAutenticazione = 'eccezione'; }],
  ] as const) {
    it(`${caso}: il messaggio si salva lo stesso, una volta, e la risposta resta {conversationId}`, async () => {
      prepara();
      const r = await apri({ sellerId: SELLER, firstMessage: TESTO });
      await lasciaGirare();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ conversationId: CONV });
      expect(stato.messaggi, 'il primo messaggio si è perso').toEqual([SALVATO]);
      expect(stato.notifiche.length + avviso.mock.calls.length, 'un avviso partito senza la rotta dei messaggi').toBe(0);
    });
  }

  it('un rifiuto di permesso della rotta dei messaggi (403, account sospeso) non si aggira con l’inserimento diretto', async () => {
    stato.secondaAutenticazione = 403;
    const r = await apri({ sellerId: SELLER, firstMessage: TESTO });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.messaggi).toEqual([]);
  });

  it('se è il database a rifiutare il messaggio non si riprova di lato, e non si avvisa', async () => {
    stato.inserimentoRifiutato = true;
    const r = await apri({ sellerId: SELLER, firstMessage: TESTO });
    await lasciaGirare();
    expect(r.status).toBe(200);
    expect(stato.messaggi).toEqual([]);
    expect(stato.notifiche).toEqual([]);
    expect(avviso).not.toHaveBeenCalled();
  });
});
