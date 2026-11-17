import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * R30-024 — Un cliente che abusa del sito si sospende, e da sospeso non compra.
 *
 * Prima la rotta di moderazione rifiutava i clienti e l'unica strada era cancellare
 * l'account. Il portiere delle rotte (lib/api/middleware.ts) leggeva solo id, ruolo e
 * is_approved, e la regola della cassa (lib/shopping-access.ts) solo il ruolo: per un
 * cliente is_approved nasce falso, quindi niente lo poteva fermare.
 * Ora: la moderazione sospende e riattiva anche i clienti (approval_status), il portiere
 * chiude a un cliente sospeso la cassa e la chat, la regola della cassa lo rifiuta. Un
 * cliente attivo passa come prima, e i diritti (cancellarsi, reso, assistenza) restano.
 */

const MARIA = { id: 'cliente-1', email: 'maria@example.com' };
const stato = vi.hoisted(() => ({
  profilo: { id: 'cliente-1', role: 'buyer', is_approved: false, approval_status: 'pending' as string | null },
  aggiornamenti: [] as Record<string, unknown>[],
  notifiche: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (g: string) =>
        g === 'gettone-di-maria' ? { data: { user: MARIA }, error: null } : { data: { user: null }, error: { message: 'x' } },
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => {} }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'm' }) }));

/** Il profilo come lo legge il database: ogni lettura riceve solo le colonne che chiede. */
function riga(colonne: string): Record<string, unknown> {
  const tutte: Record<string, unknown> = { ...stato.profilo, store_name: null, full_name: 'Maria', legal_birth_date: null };
  if (colonne.includes('*')) return tutte;
  const fuori: Record<string, unknown> = {};
  for (const c of colonne.split(',').map((x) => x.trim()).filter(Boolean)) if (c in tutte) fuori[c] = tutte[c];
  return fuori;
}

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => null,
  getServerSupabase: async () => ({}),
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: MARIA.email } }, error: null }) } },
    from: (tabella: string) => {
      if (tabella === 'profiles') {
        return {
          select: (colonne: string) => ({
            eq: () => ({
              single: async () => ({ data: riga(colonne), error: null }),
              maybeSingle: async () => ({ data: riga(colonne), error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            stato.aggiornamenti.push(patch);
            const b: Record<string, unknown> = {
              eq: () => b,
              is: () => b,
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
                Promise.resolve({ error: null, count: 1 }).then(ok, ko),
            };
            return b;
          },
        };
      }
      return {
        insert: async (r: Record<string, unknown>) => {
          stato.notifiche.push(r);
          return { error: null };
        },
      };
    },
  }),
}));

import { withAuth, withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { purchaseBlockReason } from '@/lib/shopping-access';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const CTX = { params: Promise.resolve({}) } as never;
const daMaria = (metodo: string, percorso: string) =>
  new Request(`http://localhost${percorso}`, { method: metodo, headers: { authorization: 'Bearer gettone-di-maria' } }) as never;

/** Una rotta finta dietro il portiere vero: se passa risponde 200. */
const conLimite = withAuthRateLimit({ name: 'prova-r30', max: 100, windowMs: 60_000 }, async () =>
  NextResponse.json({ entrato: true }),
) as unknown as (r: never, c: never) => Promise<Response>;
const senzaLimite = withAuth(async () => NextResponse.json({ entrato: true })) as unknown as (
  r: never,
  c: never,
) => Promise<Response>;

beforeEach(() => {
  __resetRateLimitBuckets();
  stato.profilo = { id: 'cliente-1', role: 'buyer', is_approved: false, approval_status: 'pending' };
  stato.aggiornamenti = [];
  stato.notifiche = [];
});

const SOSPESO = () => {
  stato.profilo = { id: 'cliente-1', role: 'buyer', is_approved: false, approval_status: 'suspended' };
};

describe('R30-024 — il portiere chiude cassa e chat al cliente sospeso', () => {
  it('sospeso: l ordine in contanti, il pagamento con la carta e il buono regalo sono rifiutati', async () => {
    SOSPESO();
    for (const p of ['/api/orders/cod', '/api/stripe/checkout', '/api/gift-cards/checkout']) {
      const r = await conLimite(daMaria('POST', p), CTX);
      expect(r.status, p).toBe(403);
      expect(JSON.stringify(await r.json())).toMatch(/sospeso/);
    }
  });

  it('sospeso: non scrive ai negozi in chat', async () => {
    SOSPESO();
    expect((await senzaLimite(daMaria('POST', '/api/chat/messages'), CTX)).status).toBe(403);
    expect((await senzaLimite(daMaria('POST', '/api/chat/conversations'), CTX)).status).toBe(403);
  });

  it('attivo: passa come prima', async () => {
    for (const p of ['/api/orders/cod', '/api/stripe/checkout', '/api/chat/messages']) {
      const r = await conLimite(daMaria('POST', p), CTX);
      expect(r.status, p).toBe(200);
    }
  });

  it('sospeso: i diritti restano (cancellarsi, reso, assistenza) e le chat si leggono', async () => {
    SOSPESO();
    for (const p of ['/api/account/delete', '/api/returns/ripensamento', '/api/support/conversation', '/api/orders/x/cancel']) {
      expect((await conLimite(daMaria('POST', p), CTX)).status, p).toBe(200);
    }
    expect((await senzaLimite(daMaria('GET', '/api/chat/conversations'), CTX)).status).toBe(200);
  });

  it('la regola della cassa: il cliente sospeso non compra, quello attivo sì', () => {
    expect(purchaseBlockReason('buyer', 'suspended') ?? 'nessun blocco').toMatch(/sospeso/);
    expect(purchaseBlockReason('buyer', 'pending')).toBeNull();
    expect(purchaseBlockReason('buyer', null)).toBeNull();
    expect(assertCanPurchase({ id: 'c', role: 'buyer', is_approved: false, approval_status: 'suspended' })?.status).toBe(403);
    expect(assertCanPurchase({ id: 'c', role: 'buyer', is_approved: false, approval_status: 'pending' })).toBeNull();
  });
});

describe('R30-024 — la moderazione sospende e riattiva un cliente', () => {
  async function modera(azione: string, motivo?: string) {
    vi.resetModules();
    vi.doMock('@/lib/api/middleware', () => ({
      withAdminAuth:
        (h: (c: unknown) => unknown) =>
        async (req: Request) =>
          h({ req, user: { id: 'admin-1' }, params: { id: 'cliente-1' } }),
    }));
    const { POST } = await import('@/app/api/admin/users/[id]/moderate/route');
    const r = (await (POST as unknown as (req: Request) => Promise<Response>)(
      new Request('http://localhost/api/admin/users/cliente-1/moderate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(motivo ? { action: azione, reason: motivo } : { action: azione }),
      }),
    )) as Response;
    vi.doUnmock('@/lib/api/middleware');
    return r;
  }

  it('sospendere un cliente attivo: 200, approval_status «suspended», avviso al cliente', async () => {
    const r = await modera('suspend', 'ordini finti in contanti');
    expect(r.status).toBe(200);
    expect(stato.aggiornamenti).toEqual([expect.objectContaining({ approval_status: 'suspended', is_approved: false })]);
    expect(stato.notifiche[0]).toMatchObject({ title: expect.stringMatching(/Account sospeso/) });
  });

  it('riattivarlo lo rimette come nasce un cliente, non «approvato»', async () => {
    SOSPESO();
    const r = await modera('reactivate');
    expect(r.status).toBe(200);
    expect(stato.aggiornamenti).toEqual([expect.objectContaining({ approval_status: 'pending', is_approved: false })]);
  });

  it('un cliente non si approva', async () => {
    const r = await modera('approve');
    expect(r.status).toBe(400);
    expect(stato.aggiornamenti).toEqual([]);
  });
});
