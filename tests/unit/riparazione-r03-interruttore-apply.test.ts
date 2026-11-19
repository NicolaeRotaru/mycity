import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-001 — CATALOG-APPLY E CATALOG-APPLY-BULK LEGGONO L'INTERRUTTORE.
 *
 * Con gli strumenti AI per i negozi spenti al lancio (AI_NEGOZI_ACCESA false,
 * carta #209) le sorelle catalog-create, catalog-batch/start e /apply
 * rispondevano 503; le due rotte che applicano le modifiche della chat e del
 * Copilot no: una richiesta fatta a mano (o da una scheda aperta prima del
 * rilascio) arrivava al database e scriveva sui prodotti.
 *
 * Qui si chiamano le rotte vere con l'interruttore spento e si guarda cosa
 * toccano: 503, nessun accesso al database, nessuna scrittura, nessun filtro,
 * nessuna voce nel registro. L'interruttore si finge con un getter, così la
 * prova non diventa rossa il giorno in cui Nicola lo riaccende, e si prova
 * anche il verso «acceso».
 */

const stato = vi.hoisted(() => ({
  aiAccesa: false,
  adminChiesto: 0,
  scritture: [] as string[],
  filtro: 0,
  audit: 0,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get AI_NEGOZI_ACCESA() {
      return stato.aiAccesa;
    },
  };
});

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'seller-1' }, req }),
}));

// Il database finto: conta chi lo chiede e annota ogni scrittura. Le letture
// rispondono «niente», così chi arriva fin qui si ferma presto, ma ci arriva.
vi.mock('@/lib/supabase/server', () => {
  const SCRITTURE = new Set(['insert', 'update', 'upsert', 'delete']);
  const catena = (dove: string): unknown => {
    const nodo: unknown = new Proxy(() => undefined, {
      get(_t, nome) {
        if (nome === 'then') {
          return (ok: (v: unknown) => unknown) => ok({ data: null, error: null, count: 0 });
        }
        return (..._a: unknown[]) => {
          if (SCRITTURE.has(String(nome))) stato.scritture.push(`${dove}.${String(nome)}`);
          return nodo;
        };
      },
    });
    return nodo;
  };
  const client = () => {
    stato.adminChiesto += 1;
    return {
      from: (tabella: string) => catena(tabella),
      rpc: (nome: string) => {
        stato.scritture.push(`rpc.${nome}`);
        return catena(`rpc.${nome}`);
      },
    };
  };
  return { getAdminSupabase: client, getServerSupabase: client };
});

vi.mock('@/lib/ai/moderation', async (importActual) => {
  const vero = await importActual<typeof import('@/lib/ai/moderation')>();
  return {
    ...vero,
    classifyProductPolicy: async () => {
      stato.filtro += 1;
      return { allowed: true };
    },
  };
});
vi.mock('@/lib/audit', () => ({
  writeAudit: async () => {
    stato.audit += 1;
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { POST as applica } from '@/app/api/ai/catalog-apply/route';
import { POST as applicaInBlocco } from '@/app/api/ai/catalog-apply-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let ip = 0;
function richiesta(url: string, corpo: unknown): never {
  ip += 1;
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${ip}` },
    body: JSON.stringify(corpo),
  }) as never;
}

const corpoChat = { productId: 'prod-1', patch: { name: 'Pane di Altamura DOP', tags: ['pane'] } };
const corpoCopilot = {
  changes: [
    { productId: 'prod-1', patch: { name: 'Pane di Altamura DOP' } },
    { productId: 'prod-2', patch: { tags: ['forno'] } },
  ],
};

beforeEach(() => {
  __resetRateLimitBuckets();
  stato.aiAccesa = false;
  stato.adminChiesto = 0;
  stato.scritture = [];
  stato.filtro = 0;
  stato.audit = 0;
});

describe('AI per i negozi spenta: le due rotte che applicano non scrivono', () => {
  it('catalog-apply (Applica nella chat): 503, nessun database, nessuna scrittura', async () => {
    const res = (await applica(richiesta('/api/ai/catalog-apply', corpoChat)).catch(() => null)) as Response | null;
    expect(res?.status).toBe(503);
    const corpo = (await res?.json()) as { error?: string; code?: string } | undefined;
    expect(JSON.stringify(corpo)).toContain('non sono ancora attivi');
    expect(stato.adminChiesto).toBe(0);
    expect(stato.scritture).toEqual([]);
    expect(stato.filtro).toBe(0);
    expect(stato.audit).toBe(0);
  });

  it('catalog-apply-bulk (Copilot in blocco): 503, nessun database, nessuna scrittura', async () => {
    const res = (await applicaInBlocco(richiesta('/api/ai/catalog-apply-bulk', corpoCopilot)).catch(
      () => null,
    )) as Response | null;
    expect(res?.status).toBe(503);
    const corpo = (await res?.json()) as { error?: string; code?: string } | undefined;
    expect(JSON.stringify(corpo)).toContain('non sono ancora attivi');
    expect(stato.adminChiesto).toBe(0);
    expect(stato.scritture).toEqual([]);
    expect(stato.filtro).toBe(0);
    expect(stato.audit).toBe(0);
  });
});

describe('controprova: AI accesa, le stesse richieste passano il freno', () => {
  it('catalog-apply va a leggere il prodotto e non risponde 503', async () => {
    stato.aiAccesa = true;
    const res = (await applica(richiesta('/api/ai/catalog-apply', corpoChat)).catch(() => null)) as Response | null;
    expect(stato.adminChiesto).toBeGreaterThan(0);
    expect(res?.status).not.toBe(503);
  });

  it('catalog-apply-bulk va a leggere i prodotti e non risponde 503', async () => {
    stato.aiAccesa = true;
    const res = (await applicaInBlocco(richiesta('/api/ai/catalog-apply-bulk', corpoCopilot)).catch(
      () => null,
    )) as Response | null;
    expect(stato.adminChiesto).toBeGreaterThan(0);
    expect(res?.status).not.toBe(503);
  });
});
