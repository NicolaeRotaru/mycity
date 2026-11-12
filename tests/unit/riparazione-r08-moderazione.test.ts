import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08 — la rotta di moderazione (app/api/admin/users/[id]/moderate/route.ts).
 *
 * Il finto Supabase qui sotto si comporta come il database: l'update tocca la
 * riga solo se TUTTI i filtri combaciano, e restituisce quante righe ha toccato.
 * Così una gara fra due richieste si vede davvero.
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  notifiche: [] as Record<string, unknown>[],
  email: [] as string[],
  // barriera: le letture aspettano finché non sono arrivate `attese` richieste
  attese: 1,
  inCoda: [] as Array<() => void>,
  erroreConteggio: null as { message: string } | null,
  conteggioLancia: false,
  consegne: 0,
  // R08-007: la colonna rejected_at può mancare (migrazione non ancora applicata)
  colonnaRejectedAt: true,
  patchTentate: [] as Record<string, unknown>[],
}));
const audit = vi.fn(async (_e: unknown) => {});

vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async (e: { to: string }) => { db.email.push(e.to); return { ok: true, id: 'm' }; } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    h({ req, user: { id: 'admin-1' }, params: { id: 'bersaglio-1' } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@example.com' } } }) } },
    from: (t: string) => {
      if (t === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: () => new Promise((ok) => {
                const fotografia = db.profilo ? { ...db.profilo } : null;
                db.inCoda.push(() => ok({ data: fotografia, error: null }));
                if (db.inCoda.length >= db.attese) db.inCoda.splice(0).forEach((f) => f());
              }),
            }),
          }),
          update: (patch: Riga) => {
            const filtri: Array<(r: Riga) => boolean> = [];
            const b: Record<string, unknown> = {
              eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return b; },
              is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return b; },
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
                db.patchTentate.push({ ...patch });
                if (!db.colonnaRejectedAt && 'rejected_at' in patch) {
                  return Promise.resolve({ error: { message: 'column "rejected_at" does not exist', code: '42703' }, count: null }).then(ok, ko);
                }
                const r = db.profilo;
                const tocca = r && filtri.every((f) => f(r));
                if (tocca) db.profilo = { ...r, ...patch };
                return Promise.resolve({ error: null, count: tocca ? 1 : 0 }).then(ok, ko);
              },
            };
            return b;
          },
        };
      }
      if (t === 'orders') {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: () => b,
          in: async () => {
            if (db.conteggioLancia) throw new Error('rete caduta');
            return { count: db.erroreConteggio ? null : db.consegne, error: db.erroreConteggio };
          },
        });
        return b;
      }
      return { insert: async (r: Riga) => { db.notifiche.push(r); return { error: null }; } };
    },
  }),
}));

import { POST } from '@/app/api/admin/users/[id]/moderate/route';
const MODERA = POST as unknown as (r: Request) => Promise<Response>;

function modera(action: string, reason?: string) {
  return MODERA(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { action, reason } : { action }),
  }));
}

const NEGOZIO = {
  id: 'bersaglio-1', role: 'seller', store_name: 'Panetteria', full_name: 'Anna', legal_birth_date: null,
  approval_status: 'pending', approved_by: null, approved_at: null, business_vat_number: '01234567897',
};
const FATTORINO = {
  id: 'bersaglio-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: '1990-01-01',
  approval_status: 'approved', approved_by: 'admin-0', kyc_id_doc_front_url: 'f', kyc_selfie_url: 's',
  rider_license_url: 'p', rider_insurance_url: 'rc', rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2099-01-01',
};

beforeEach(() => {
  db.notifiche = []; db.email = []; db.attese = 1; db.inCoda = []; db.patchTentate = [];
  db.erroreConteggio = null; db.conteggioLancia = false; db.consegne = 0; db.colonnaRejectedAt = true;
  audit.mockClear();
});

describe('R08-004 — approva e rifiuta guardano lo stato di partenza', () => {
  it('una scheda vecchia che preme «Rifiuta» su un negozio già approvato riceve 409 e non manda niente', async () => {
    db.profilo = { ...NEGOZIO, approval_status: 'approved', approved_by: 'admin-0' };
    const r = await modera('reject', 'documenti incompleti');
    expect(r.status).toBe(409);
    expect(db.profilo?.approval_status).toBe('approved');
    expect(db.notifiche).toEqual([]);
    expect(db.email).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('approva e rifiuta premuti insieme da due amministratori: passa uno solo, il negozio riceve un solo esito', async () => {
    db.profilo = { ...NEGOZIO };
    db.attese = 2;
    const [a, b] = await Promise.all([modera('approve'), modera('reject', 'non idoneo')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.notifiche).toHaveLength(1);
    expect(db.email).toHaveLength(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('una richiesta in attesa si approva ancora normalmente', async () => {
    db.profilo = { ...NEGOZIO };
    expect((await modera('approve')).status).toBe(200);
    expect(db.profilo?.approval_status).toBe('approved');
  });
});

describe('R08-005 — due sospensioni insieme', () => {
  it('passa una sola: una campanella, una email, una riga user.suspend; l’altra riceve 409', async () => {
    db.profilo = { ...NEGOZIO, approval_status: 'approved', approved_by: 'admin-0' };
    db.attese = 2;
    const [a, b] = await Promise.all([modera('suspend', 'controllo'), modera('suspend', 'controllo')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.notifiche).toHaveLength(1);
    expect(db.email).toHaveLength(1);
    expect(audit.mock.calls.filter((c) => (c[0] as { action: string }).action === 'user.suspend')).toHaveLength(1);
  });

  it('sospendere chi è già sospeso risponde 409', async () => {
    db.profilo = { ...NEGOZIO, approval_status: 'suspended', approved_by: 'admin-0' };
    expect((await modera('suspend', 'x')).status).toBe(409);
  });
});

describe('R08-006 — il conteggio delle consegne che cade non resta muto', () => {
  it('con un errore del conteggio la risposta avvisa di controllare le consegne in Ordini', async () => {
    db.profilo = { ...FATTORINO };
    db.erroreConteggio = { message: 'timeout' };
    const j = (await (await modera('suspend', 'reclami')).json()) as { avviso?: string };
    expect(j.avviso ?? 'nessun avviso').toMatch(/non ho potuto contare le consegne in corso/);
    expect(j.avviso ?? 'nessun avviso').toMatch(/Ordini/);
  });

  it('anche se il conteggio lancia un’eccezione', async () => {
    db.profilo = { ...FATTORINO };
    db.conteggioLancia = true;
    const j = (await (await modera('suspend', 'reclami')).json()) as { avviso?: string };
    expect(j.avviso ?? 'nessun avviso').toMatch(/non ho potuto contare le consegne in corso/);
  });

  it('con zero consegne contate davvero non c’è avviso', async () => {
    db.profilo = { ...FATTORINO };
    const j = (await (await modera('suspend', 'reclami')).json()) as { avviso?: string };
    expect(j.avviso).toBeUndefined();
  });
});
