import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — CHI MANDA TROPPA ROBA LEGGEVA «DATI NON VALIDI».
 *
 * Il tetto sul corpo delle richieste solleva un errore che porta con sé il
 * codice giusto — 413, «corpo troppo grande» — ma tre rotte lo raccoglievano
 * nello stesso `catch` della validazione e rispondevano 400 «Dati non validi».
 * Il fattorino che conferma l'incasso, il cliente che apre un reso e il
 * negoziante che lo fa avanzare leggevano tutti lo stesso messaggio sbagliato:
 * non capivano che dovevano solo mandare meno roba. E nei registri un limite
 * superato non si distingueva da un errore del browser, cioè un abuso di
 * dimensione non si distingueva da un difetto.
 *
 * Le rotte AI questa distinzione ce l'hanno da fine agosto (R153): queste tre
 * no, ed è lo stesso `catch` copiato tre volte.
 */

const UTENTE = { id: 'buyer-1', email: 'b@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  // L'involucro vero risolve anche i pezzi dell'indirizzo (`params`) prima di
  // chiamare la rotta: `avanza` legge da lì l'id del reso.
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: typeof UTENTE; req: Request; params: Record<string, string> }) => unknown,
    ) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: UTENTE, req, params: (await ctx?.params) ?? {} }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => {
  const vuoto = { data: null, error: { message: 'non ci arriva mai' } };
  const from = () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve(vuoto),
        in: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve(vuoto) }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  });
  return {
    getServerSupabase: vi.fn(() => ({ from })),
    getAdminSupabase: vi.fn(() => ({ from })),
  };
});

import { POST as CONFERMA_CONTANTI } from '@/app/api/rider/cash-confirm/route';
import { POST as APRI_RESO } from '@/app/api/returns/create/route';
import { POST as AVANZA_RESO } from '@/app/api/returns/[id]/avanza/route';

const UUID = '11111111-1111-1111-1111-111111111111';

/** Due megabyte: sopra il tetto di un JSON senza foto (1 MB). */
const ZAVORRA = 'x'.repeat(2 * 1024 * 1024);

function richiesta(url: string, corpo: string): never {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpo,
  }) as never;
}

const rotte: Array<{
  nome: string;
  chiama: (corpo: string) => Promise<Response>;
  troppoGrande: string;
  rotto: string;
}> = [
  {
    nome: 'la conferma dei contanti del fattorino',
    chiama: (corpo) => CONFERMA_CONTANTI(richiesta('http://localhost/api/rider/cash-confirm', corpo)),
    troppoGrande: JSON.stringify({ orderId: UUID, cashCollectedCents: 1000, zavorra: ZAVORRA }),
    rotto: '{ questo non e json',
  },
  {
    nome: "l'apertura di un reso",
    chiama: (corpo) => APRI_RESO(richiesta('http://localhost/api/returns/create', corpo)),
    troppoGrande: JSON.stringify({ orderId: UUID, reason: 'DAMAGED', zavorra: ZAVORRA }),
    rotto: '{ questo non e json',
  },
  {
    nome: 'il reso che avanza di tappa',
    chiama: (corpo) =>
      AVANZA_RESO(richiesta(`http://localhost/api/returns/${UUID}/avanza`, corpo), {
        params: Promise.resolve({ id: UUID }),
      } as never),
    troppoGrande: JSON.stringify({ stato: 'RECEIVED', zavorra: ZAVORRA }),
    rotto: '{ questo non e json',
  },
];

describe('un corpo troppo grande si dice per quello che è', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const rotta of rotte) {
    it(`${rotta.nome}: oltre il tetto risponde 413, non «dati non validi»`, async () => {
      const res = await rotta.chiama(rotta.troppoGrande);
      expect(
        res.status,
        'a chi manda troppa roba si risponde «Dati non validi»: non può capire cosa deve cambiare',
      ).toBe(413);
      const corpo = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(corpo.error?.code).toBe('PAYLOAD_TOO_LARGE');
      expect(corpo.error?.message ?? '').toMatch(/troppo grande/i);
    });

    it(`${rotta.nome}: un JSON davvero rotto resta un 400`, async () => {
      const res = await rotta.chiama(rotta.rotto);
      expect(res.status, 'i due casi vanno distinti in tutti e due i versi').toBe(400);
    });
  }
});
