import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — «SCARICA I MIEI DATI» POTEVA RISPONDERE UNA BUGIA.
 *
 * Le sezioni dell'export nascevano da `esito.data ?? []`: il campo `error`
 * della risposta finiva nel cestino. Una tabella che non rispondeva usciva nel
 * file come `"portafoglio": []` — identico, indistinguibile, da «non hai
 * niente». Chi esercita il diritto di accesso (art. 15 e 20 GDPR) si portava a
 * casa un file che dice il falso, senza nessun modo di accorgersene.
 *
 * Questa prova è il freno. Fa cadere UNA lettura e pretende che il file lo
 * dica: la sezione non è mai una lista vuota, compare in `letture_fallite`,
 * `export_completo` è false e il nome del file porta «INCOMPLETO».
 *
 * E pretende anche il contrario, che è la metà che si dimentica sempre: una
 * tabella davvero vuota deve continuare a uscire `[]`. Un freno che chiama
 * «guasto» ogni sezione vuota sarebbe soltanto una bugia diversa.
 */

const FAKE_USER = { id: 'user-123', email: 'test@user.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: typeof FAKE_USER }) => unknown) => () => handler({ user: FAKE_USER }),
  withAuthRateLimit: (_opts: unknown, handler: (ctx: { user: typeof FAKE_USER }) => unknown) => () =>
    handler({ user: FAKE_USER }),
}));

/** Le risposte finte, una per tabella. Vuoto = lettura riuscita e senza righe. */
const risposte: Record<string, { data: unknown; error: unknown }> = {};
const ANDATA_BENE = { data: [], error: null };

function catena(tabella: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'single', 'update', 'insert', 'order', 'limit']) {
    c[m] = vi.fn(() => {
      if (m === 'single') return Promise.resolve(risposte[tabella] ?? { data: null, error: null });
      return c;
    });
  }
  (c as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(risposte[tabella] ?? ANDATA_BENE);
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn((tabella: string) => catena(tabella)),
    auth: { admin: { deleteUser: vi.fn(() => Promise.resolve({ error: null })) } },
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { GET } from '@/app/api/account/export/route';

type Esito = { corpo: Record<string, unknown>; nomeFile: string };

async function scarica(): Promise<Esito> {
  const res = await (GET as unknown as () => Promise<Response>)();
  return {
    corpo: (await res.json()) as Record<string, unknown>,
    nomeFile: res.headers.get('content-disposition') ?? '',
  };
}

/** Fa cadere la lettura di una tabella, come farebbe il database in panne. */
function cade(tabella: string) {
  risposte[tabella] = {
    data: null,
    error: { message: 'connessione al database caduta', code: '57P01' },
  };
}

describe('scarica i miei dati — una lettura caduta non esce come elenco vuoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(risposte)) delete risposte[k];
  });

  it('il portafoglio che non risponde NON esce come lista vuota', async () => {
    cade('wallet_ledger');
    const { corpo } = await scarica();

    expect(
      corpo.portafoglio,
      'una lettura caduta è uscita come «[]»: al cliente vuol dire «non hai niente», ed è falso',
    ).not.toEqual([]);
    expect(corpo.portafoglio).toBeNull();
  });

  it('il file dice quali sezioni non è riuscito a leggere', async () => {
    cade('wallet_ledger');
    const { corpo } = await scarica();

    const fallite = corpo.letture_fallite as { sezione: string; motivo: string }[];
    expect(Array.isArray(fallite)).toBe(true);
    expect(fallite.map((f) => f.sezione)).toContain('portafoglio');
    // Al cliente diciamo che manca e che può riaverla, non il messaggio
    // grezzo del database: quello resta nei log, per chi ripara.
    expect(fallite[0].motivo).toContain('non siamo riusciti a leggere');
    expect(JSON.stringify(corpo)).not.toContain('57P01');
  });

  it('il file si dichiara incompleto, in testa e nel nome', async () => {
    cade('loyalty_accounts');
    const { corpo, nomeFile } = await scarica();

    const testa = corpo.export_metadata as { export_completo: boolean; note: string };
    expect(testa.export_completo).toBe(false);
    expect(testa.note).toContain('NON è completo');
    expect(nomeFile).toContain('INCOMPLETO');
  });

  it('vale anche per le sezioni storiche, non solo per le venticinque nuove', async () => {
    cade('orders');
    const { corpo } = await scarica();

    expect(corpo.orders_as_buyer).not.toEqual([]);
    expect(corpo.orders_as_buyer).toBeNull();
    const fallite = corpo.letture_fallite as { sezione: string }[];
    expect(fallite.map((f) => f.sezione)).toContain('orders_as_buyer');
  });

  it('vale anche dentro le sezioni annidate (recensioni, chat)', async () => {
    cade('store_reviews');
    const { corpo } = await scarica();

    const recensioni = corpo.reviews as Record<string, unknown>;
    expect(recensioni.stores).toBeNull();
    expect(recensioni.products).toEqual([]); // questa si è letta davvero
    const fallite = corpo.letture_fallite as { sezione: string }[];
    expect(fallite.map((f) => f.sezione)).toContain('reviews.stores');
  });

  it('più letture cadute finiscono tutte nell elenco, nessuna si perde', async () => {
    cade('wallet_ledger');
    cade('gift_cards');
    cade('segnalazioni');
    const { corpo } = await scarica();

    const fallite = corpo.letture_fallite as { sezione: string }[];
    expect(fallite.map((f) => f.sezione).sort()).toEqual(
      ['buoni_regalo', 'portafoglio', 'segnalazioni_fatte'].sort(),
    );
  });

  it('quando tutto si legge, una sezione vuota resta una lista vuota', async () => {
    const { corpo, nomeFile } = await scarica();

    expect(corpo.letture_fallite).toEqual([]);
    const testa = corpo.export_metadata as { export_completo: boolean; note: string };
    expect(testa.export_completo).toBe(true);
    expect(testa.note).toContain('tutti i dati personali');
    expect(nomeFile).not.toContain('INCOMPLETO');

    // La metà che si dimentica: chi davvero non ha nulla deve vedere «[]»,
    // non un null che sembra un guasto.
    expect(corpo.portafoglio).toEqual([]);
    expect(corpo.addresses).toEqual([]);
    expect(corpo.traguardi).toEqual([]);
  });

  it('nessuna sezione esce null se non è stata dichiarata caduta', async () => {
    cade('wallet_ledger');
    const { corpo } = await scarica();

    const dichiarate = new Set(
      (corpo.letture_fallite as { sezione: string }[]).map((f) => f.sezione),
    );
    const salta = new Set(['export_metadata', 'letture_fallite', 'profile']);
    for (const [chiave, valore] of Object.entries(corpo)) {
      if (salta.has(chiave)) continue;
      if (valore === null) {
        expect(dichiarate.has(chiave), `${chiave} è null ma non è in letture_fallite`).toBe(true);
      }
    }
  });
});
