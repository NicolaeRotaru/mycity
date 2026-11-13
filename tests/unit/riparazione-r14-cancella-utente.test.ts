import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoMondo } from './aiuti/finta-cancellazione-account';

/**
 * R14 · la cancellazione di un utente dal pannello amministratori.
 *
 * R14-008 — La pagina nasconde il bottone «Elimina» sulle righe degli
 * amministratori, ma la rotta accettava lo stesso la cancellazione: bastava una
 * chiamata diretta. Qui la rotta gira davvero, con la pipeline vera di
 * cancellazione sopra un finto database: un amministratore non si cancella.
 *
 * R14-007 — Due cancellazioni dello stesso account partite insieme (doppio
 * clic, due amministratori): una chiudeva l'account, l'altra riceveva dal
 * servizio di accesso «utente non trovato» e rispondeva con un errore falso.
 * E il conto Stripe collegato di un negozio si annotava due volte nel registro.
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
/** «Utente non trovato», come lo dice il servizio di accesso di Supabase. */
const UTENTE_NON_TROVATO = { message: 'User not found', status: 404, code: 'user_not_found' };

function mondoDellaRotta() {
  const mondo = fintoMondo();
  let chiusure = 0;
  let chiuso = false;
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
        // L'account si chiude una volta: chi arriva dopo trova «utente non trovato».
        deleteUser: async () => {
          const giaChiuso = chiuso;
          chiuso = true;
          await new Promise((r) => setTimeout(r, 2));
          if (giaChiuso) return { error: UTENTE_NON_TROVATO };
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

describe('R14-007 — due cancellazioni dello stesso account partite insieme', () => {
  it('niente errore falso e una sola riga «user.delete» nel registro', async () => {
    const m = mondoDellaRotta();
    db.admin = m.admin;

    const [a, b] = await Promise.all([cancella(BERSAGLIO), cancella(BERSAGLIO)]);

    expect(m.chiusure()).toBe(1);
    expect([a.status, b.status], 'la seconda cancellazione risponde con un errore falso').toEqual([200, 200]);
    expect(audit.righe.filter((r) => r.action === 'user.delete'), 'riga doppia nel registro').toHaveLength(1);
  });

  it('un errore vero del servizio di accesso resta un errore', async () => {
    const m = mondoDellaRotta();
    db.admin = {
      ...m.admin,
      auth: { admin: { ...m.admin.auth.admin, deleteUser: async () => ({ error: { message: 'database error', status: 500 } }) } },
    };

    const res = await cancella(BERSAGLIO);

    expect(res.status).toBe(500);
    expect(audit.righe.filter((r) => r.action === 'user.delete')).toHaveLength(0);
  });

  it('il conto Stripe collegato di un negozio si annota una volta sola nel registro', async () => {
    const { cancellaAccount } = await import('@/lib/account/cancellazione');
    const m = mondoDellaRotta();
    // Il registro delle azioni con la sua chiave primaria: lo stesso id non entra due volte.
    const registro: Array<Record<string, unknown>> = [];
    const admin = {
      ...m.admin,
      from(tabella: string) {
        if (tabella === 'audit_logs') {
          return {
            insert: async (righe: Array<Record<string, unknown>>) => {
              await new Promise((r) => setTimeout(r, 1));
              for (const riga of righe) {
                const id = riga.id ?? `generato-${registro.length}`;
                if (registro.some((x) => x.id === id)) {
                  return { error: { message: 'duplicate key value violates unique constraint "audit_logs_pkey"' } };
                }
                registro.push({ ...riga, id });
              }
              return { error: null };
            },
          };
        }
        const base = m.admin.from(tabella);
        if (tabella !== 'profiles') return base;
        return {
          ...base,
          select(colonne: string) {
            if (colonne.includes('stripe_account_id')) {
              return { eq: async () => ({ data: [{ stripe_customer_id: null, stripe_account_id: 'acct_forno' }], error: null }) };
            }
            return base.select(colonne);
          },
        };
      },
    };

    const [a, b] = await Promise.all([
      cancellaAccount(admin as never, BERSAGLIO),
      cancellaAccount(admin as never, BERSAGLIO),
    ]);

    expect([a.ok, b.ok], 'la seconda cancellazione si ferma sul registro o sull account gia chiuso').toEqual([true, true]);
    const annotazioni = registro.filter((r) => r.action === 'account.cancellazione.conto_stripe_da_chiudere');
    expect(annotazioni, 'due righe «conto da chiudere» per lo stesso conto').toHaveLength(1);
    expect(annotazioni[0].metadata).toEqual({ conto: 'acct_forno' });
  });
});
