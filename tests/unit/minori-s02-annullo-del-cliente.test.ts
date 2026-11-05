import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sessione S02 (5/11/2026) — l'annullo del cliente.
 * ① un id che non è un UUID risponde 404 «Ordine non trovato», non 500;
 * ② il 409 dice il motivo vero (consegnato, in consegna, accettato);
 * ③ la campanella che cade lascia una riga nel registro e, per il negozio,
 *    un avviso agli amministratori.
 */
const stato = vi.hoisted(() => ({
  ordine: null as Record<string, unknown> | null,
  letture: 0,
  erroreCampanella: null as null | { message: string },
  campanelle: [] as unknown[],
}));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
const notifyAdmins = vi.hoisted(() => vi.fn(async () => 'scritto'));
const annullaERimborsa = vi.hoisted(() => vi.fn(async () => ({ ok: true, refundId: null })));

vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins }));
vi.mock('@/lib/ordini/annulla', () => ({ annullaERimborsa, COLONNE_ANNULLO: 'id' }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'notifications') {
        return { insert: async (r: unknown) => { stato.campanelle.push(r); return { error: stato.erroreCampanella }; } };
      }
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          stato.letture++;
          if (!/^[0-9a-f-]{36}$/.test(v)) return { maybeSingle: async () => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }) };
          return { maybeSingle: async () => ({ data: stato.ordine, error: null }) };
        },
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'cliente1' }, params: ctx.params }),
}));

import { POST } from '@/app/api/orders/[id]/cancel/route';
import { scriviCampanella } from '@/lib/ordini/campanella';

const ID = '11111111-2222-4333-8444-555555555555';
const chiama = (id: string) => (POST as unknown as (r: unknown, c: unknown) => Promise<Response>)({}, { params: { id } });

beforeEach(() => {
  stato.ordine = { id: ID, user_id: 'cliente1', seller_id: 'forno1', delivery_status: 'NEW' };
  stato.letture = 0;
  stato.erroreCampanella = null;
  stato.campanelle = [];
  logger.error.mockClear();
  notifyAdmins.mockClear();
});

describe('annullo del cliente', () => {
  it('① un id inventato risponde 404 «Ordine non trovato» e non scrive un errore nel registro', async () => {
    const r = await chiama('abc');
    expect(r.status).toBe(404);
    const corpo = await r.json();
    expect(JSON.stringify(corpo)).toContain('Ordine non trovato');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('② su un ordine consegnato il 409 non dice «il negozio ha già accettato»', async () => {
    stato.ordine = { ...stato.ordine!, delivery_status: 'DELIVERED' };
    const r = await chiama(ID);
    expect(r.status).toBe(409);
    const testo = JSON.stringify(await r.json());
    expect(testo).toContain('già stato consegnato');
    expect(testo).not.toContain('ha già accettato');
  });

  it('② in consegna il motivo è «già in consegna»; accettato resta «ha già accettato»', async () => {
    stato.ordine = { ...stato.ordine!, delivery_status: 'OUT_FOR_DELIVERY' };
    expect(JSON.stringify(await (await chiama(ID)).json())).toContain('già in consegna');
    stato.ordine = { ...stato.ordine!, delivery_status: 'ACCEPTED' };
    expect(JSON.stringify(await (await chiama(ID)).json())).toContain('ha già accettato');
  });

  it('③ se la campanella cade, resta una riga nel registro e gli amministratori sono avvisati', async () => {
    stato.erroreCampanella = { message: 'timeout' };
    const r = await chiama(ID);
    expect(r.status).toBe(200);
    expect(stato.campanelle).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('campanella'), expect.objectContaining({ orderId: ID }));
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('③ scriviCampanella senza ripiego registra l errore e risponde false, senza lanciare', async () => {
    const admin = { from: () => ({ insert: async () => ({ error: { message: 'giù' } }) }) };
    const ok = await scriviCampanella(admin as never, { user_id: 'u', title: 't' }, { dove: 'prova', reso: 'r1' });
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('[prova] avviso nella campanella non scritto', expect.objectContaining({ returnId: 'r1' }));
    expect(notifyAdmins).not.toHaveBeenCalled();
  });
});

describe('le sette rotte di annullo, reso e reclamo leggono l esito della campanella', () => {
  it('nessuna scrive più la campanella con un insert nudo', async () => {
    const { readFileSync } = await import('node:fs');
    const rotte = [
      'app/api/orders/[id]/cancel/route.ts',
      'app/api/admin/orders/[id]/cancel/route.ts',
      'app/api/returns/create/route.ts',
      'app/api/returns/[id]/decide/route.ts',
      'app/api/returns/[id]/avanza/route.ts',
      'app/api/admin/disputes/[id]/resolve/route.ts',
      'app/api/cron/expire-stale-orders/route.ts',
    ];
    for (const r of rotte) {
      const src = readFileSync(r, 'utf8');
      expect(src, r).not.toMatch(/await admin\.from\('notifications'\)\.insert\(/);
      expect(src, r).toContain('scriviCampanella(admin');
    }
  });
});
