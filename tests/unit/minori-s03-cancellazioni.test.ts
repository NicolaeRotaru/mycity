import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S03 — il giro notturno delle cancellazioni (schede 2039, 118, 2437, 2661, 2000).
 * Il finto database è quello di api-cron-deletions.test.ts, con la rilettura del profilo.
 */

type ErrResult = { error: null | { message: string } };
type RispostaRpc = { data: unknown; error: null | { message: string } };
const rpcMock = vi.fn<(nome: string, argomenti?: Record<string, unknown>) => Promise<RispostaRpc>>();
const updateEqMock = vi.fn<() => Promise<ErrResult>>(() => Promise.resolve({ error: null }));
const deleteUserMock = vi.fn<(id: string) => Promise<ErrResult>>(() => Promise.resolve({ error: null }));
// 3/9/2026 — La cancellazione, prima di toccare qualunque cosa, legge la cassa
// contanti del fattorino: se ha ancora soldi da versare non si cancella niente.
// Senza questa lettura il finto database non somiglia più a quello vero.
const selectEqMock = vi.fn<() => Promise<{ data: unknown[]; error: null | { message: string } }>>(
  () => Promise.resolve({ data: [], error: null }),
);

/** Cosa risponde `process_expired_deletions`: lo decide ogni prova. */
let scaduti: RispostaRpc = { data: [], error: null };
/** Chi ha annullato la richiesta mentre il giro girava. */
const annullate = new Set<string>();

/**
 * 8/9/2026 — IL FINTO DATABASE NON SAPEVA POTARE, E PASSAVA LO STESSO.
 *
 * Questo finto client conosceva `update().eq()` e basta. Le potature dei dati
 * vecchi usano `update().lt().not()`: qui esplodevano tutte, e il lavoro
 * rispondeva 200 lo stesso perché il difetto vero era proprio quello — un
 * `try/catch` solo intorno a tutte, che ingoiava la prima caduta e saltava le
 * altre. Riparato quel difetto, la prova non poteva più restare in piedi su un
 * finto database che non somiglia a quello vero.
 *
 * Adesso la catena dei filtri c'è. Il discrimine è `.lt()`: le potature
 * guardano SEMPRE una finestra di tempo, la cancellazione di un singolo account
 * non lo fa mai. Così `updateEqMock` continua a rispondere per le scritture
 * della cancellazione — quelle su cui questa prova asserisce — e le potature
 * riescono senza rubargli i `mockResolvedValueOnce`.
 */
function catena(scriviConMock: boolean) {
  let finestraDiTempo = false;
  const c: Record<string, unknown> = {
    then: (risolvi: (v: ErrResult) => unknown) =>
      (finestraDiTempo || !scriviConMock
        ? Promise.resolve({ error: null } as ErrResult)
        : updateEqMock()).then(risolvi),
  };
  c.lt = () => { finestraDiTempo = true; return c; };
  for (const filtro of ['eq', 'is', 'not', 'or']) c[filtro] = () => c;
  return c;
}

/** Una lettura che accetta i filtri della paginazione e non trova niente. */
function letturaVuota(): Record<string, unknown> {
  const l: Record<string, unknown> = {
    then: (risolvi: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(risolvi),
  };
  for (const f of ['or', 'order', 'gt', 'eq', 'limit']) l[f] = () => l;
  return l;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: rpcMock,
    from: vi.fn(() => ({
      update: vi.fn(() => catena(true)),
      // 1/11/2026 — La notte legge anche i riferimenti ai documenti nei profili
      // (le copie orfane, lib/privacy/orfani-kyc.ts): `or().order().limit()`.
      select: vi.fn((colonne?: string) => ({
        eq: (...a: unknown[]) =>
          colonne === 'deletion_requested_at'
            ? { maybeSingle: async () => ({ data: { deletion_requested_at: annullate.has(String(a[1])) ? null : '2026-10-01T00:00:00Z' }, error: null }) }
            : (selectEqMock as unknown as (...x: unknown[]) => unknown)(...a),
        or: () => letturaVuota(),
      })),
      delete: vi.fn(() => ({ ...catena(false), ilike: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
    auth: { admin: { deleteUser: deleteUserMock } },
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(() => Promise.resolve({ error: null })),
        // Il secchio dei documenti, vuoto: la notte lo elenca per trovare le copie orfane.
        list: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    },
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { POST } from '@/app/api/cron/process-deletions/route';

function makeReq(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new Request('http://localhost/api/cron/process-deletions', { method: 'POST', headers });
}

describe('giro notturno delle cancellazioni', () => {
  const savedEnv = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    annullate.clear();
    process.env.CRON_SECRET = 'secret123';
    scaduti = { data: [], error: null };
    rpcMock.mockImplementation(async (nome: string) => (nome === 'process_expired_deletions' ? scaduti : { data: [], error: null }));
    updateEqMock.mockResolvedValue({ error: null });
    deleteUserMock.mockResolvedValue({ error: null });
    selectEqMock.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => { process.env.CRON_SECRET = savedEnv; });

  it('2039 — il corpo non porta gli identificativi né i motivi', async () => {
    scaduti = { data: [{ user_id: 'utente-segreto' }], error: null };
    deleteUserMock.mockResolvedValueOnce({ error: { message: 'contanti 45,00 € non versati' } });
    const res = await POST(makeReq('Bearer secret123') as never);
    const testo = JSON.stringify(await res.json());
    expect(testo).not.toContain('utente-segreto');
    expect(testo).not.toContain('45,00');
  });

  it('2039 — il 500 della RPC non porta il testo grezzo del database', async () => {
    scaduti = { data: null, error: { message: 'relation profiles_segreta does not exist' } };
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('profiles_segreta');
  });

  it('118 — chi annulla mentre il giro gira non viene cancellato', async () => {
    scaduti = { data: [{ user_id: 'anna' }, { user_id: 'bruno' }], error: null };
    annullate.add('anna');
    const res = await POST(makeReq('Bearer secret123') as never);
    const json = await res.json();
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledWith('bruno');
    expect(json.annullateNelFrattempo).toBe(1);
  });

  it('2437 — il conto a mano dice che è un tetto', async () => {
    scaduti = { data: [{ user_id: 'u1', deleted_at: '2026-10-01' }], error: null };
    const res = await POST(new Request('http://localhost/api/cron/process-deletions?a_mano=1', { method: 'POST', headers: { authorization: 'Bearer secret123' } }) as never);
    const json = await res.json();
    expect(json.account.nota).toMatch(/Al massimo/);
  });

  it('2661 e 2000 — i commenti dicono il vero e stanno sopra la funzione giusta', () => {
    const src = readFileSync('app/api/cron/process-deletions/route.ts', 'utf8');
    expect(src).not.toMatch(/il client che conta non lo sa fare/);
    expect(src).toMatch(/Scrive l'avviso nel pannello degli amministratori\.[\s\S]{0,1200}\*\/\nasync function avvisaAmministratori/);
  });
});
