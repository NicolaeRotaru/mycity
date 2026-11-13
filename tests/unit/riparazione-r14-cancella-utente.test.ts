import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoMondo } from './aiuti/finta-cancellazione-account';

/**
 * R14 · la cancellazione di un utente dal pannello amministratori.
 *
 * R14-008 — La pagina nasconde il bottone «Elimina» sulle righe degli
 * amministratori, ma la rotta accettava lo stesso la cancellazione: bastava una
 * chiamata diretta. Qui la rotta gira davvero, con la pipeline vera di
 * cancellazione sopra un finto database: un amministratore non si cancella.
 */

const CHIAMANTE = { id: '99999999-9999-4999-8999-999999999999' };
const BERSAGLIO = '11111111-1111-4111-8111-111111111111';

const audit = vi.hoisted(() => ({ righe: [] as Array<{ action: string; targetId?: string }> }));
const db = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  admin: null as unknown,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: '99999999-9999-4999-8999-999999999999' }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (r: { action: string; targetId?: string }) => {
    audit.righe.push({ action: r.action, targetId: r.targetId });
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ customers: { del: async (id: string) => ({ id, deleted: true }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db.admin }));

import { DELETE } from '@/app/api/admin/users/[id]/delete/route';

/**
 * Il finto mondo dell'aiuto comune (tests/unit/aiuti/finta-cancellazione-account.ts),
 * più le due cose che la rotta chiede e l'aiuto non ha: la lettura del profilo
 * con `.single()` e un conto delle volte che l'account viene chiuso.
 */
function mondoDellaRotta() {
  const mondo = fintoMondo();
  let chiusure = 0;
  const admin = {
    ...mondo.admin,
    from(tabella: string) {
      const base = mondo.admin.from(tabella);
      if (tabella !== 'profiles') return base;
      return {
        ...base,
        select(colonne: string) {
          if (colonne.includes('role')) {
            return { eq: () => ({ single: async () => ({ data: db.profilo, error: null }) }) };
          }
          return base.select(colonne);
        },
      };
    },
    auth: {
      admin: {
        ...mondo.admin.auth.admin,
        deleteUser: async () => {
          chiusure++;
          return { error: null };
        },
      },
    },
  };
  return { admin, chiusure: () => chiusure };
}

function cancella(id: string) {
  const req = new Request(`http://localhost/api/admin/users/${id}/delete`, { method: 'DELETE' });
  return DELETE(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  audit.righe.length = 0;
  db.profilo = { id: BERSAGLIO, role: 'buyer', full_name: 'Maria Rossi', store_name: null };
});

describe('R14-008 — un amministratore non si cancella dal pannello', () => {
  it('la rotta rifiuta la cancellazione di un amministratore, come la pagina che nasconde il bottone', async () => {
    const m = mondoDellaRotta();
    db.admin = m.admin;
    db.profilo = { id: BERSAGLIO, role: 'admin', full_name: 'Anna Admin', store_name: null };

    const res = await cancella(BERSAGLIO);

    expect(res.status, 'una chiamata diretta cancella un amministratore').toBe(403);
    expect(m.chiusure(), 'l account dell amministratore e stato chiuso').toBe(0);
    expect(audit.righe.filter((r) => r.action === 'user.delete')).toHaveLength(0);
  });

  it('un cliente si cancella come prima', async () => {
    const m = mondoDellaRotta();
    db.admin = m.admin;

    const res = await cancella(BERSAGLIO);

    expect(res.status).toBe(200);
    expect(m.chiusure()).toBe(1);
    expect(audit.righe.filter((r) => r.action === 'user.delete')).toHaveLength(1);
  });

  it("l'amministratore che chiama non e il bersaglio: resta il rifiuto di cancellare se stesso", async () => {
    const m = mondoDellaRotta();
    db.admin = m.admin;
    db.profilo = { id: CHIAMANTE.id, role: 'admin', full_name: 'Io', store_name: null };

    const res = await cancella(CHIAMANTE.id);

    expect(res.status).toBe(400);
    expect(m.chiusure()).toBe(0);
  });
});
