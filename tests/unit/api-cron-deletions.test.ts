import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Test cron/process-deletions — GDPR hard-delete dopo cooldown 7gg.
 * withCronAuth è reale (testa anche CRON_SECRET enforcement).
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

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: rpcMock,
    from: vi.fn(() => ({
      update: vi.fn(() => catena(true)),
      select: vi.fn(() => ({ eq: selectEqMock })),
      delete: vi.fn(() => ({ ...catena(false), ilike: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
    auth: { admin: { deleteUser: deleteUserMock } },
    storage: { from: vi.fn(() => ({ remove: vi.fn(() => Promise.resolve({ error: null })) })) },
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

describe('POST /api/cron/process-deletions', () => {
  const savedEnv = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret123';
    // Le funzioni del database chiamate in una notte sono cinque, e
    // `process_expired_deletions` non è più la prima: si risponde per nome, non
    // per turno, se no il primo `once` se lo prende la potatura dei consensi.
    scaduti = { data: [], error: null };
    rpcMock.mockImplementation(async (nome: string) =>
      (nome === 'process_expired_deletions' ? scaduti : { data: [], error: null }));
    updateEqMock.mockResolvedValue({ error: null });
    deleteUserMock.mockResolvedValue({ error: null });
    selectEqMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    process.env.CRON_SECRET = savedEnv;
  });

  it('503 se CRON_SECRET non configurato', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeReq('Bearer x') as never);
    expect(res.status).toBe(503);
  });

  it('401 se bearer errato', async () => {
    const res = await POST(makeReq('Bearer wrong') as never);
    expect(res.status).toBe(401);
  });

  it('processed:0 quando nessun account scaduto', async () => {
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(rpcMock).toHaveBeenCalledWith('process_expired_deletions');
  });

  it('500 se RPC fallisce', async () => {
    scaduti = { data: null, error: { message: 'RPC error' } };
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(500);
  });

  it('anonimizza + hard-delete ogni utente scaduto', async () => {
    scaduti = { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null };
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(2);
    expect(json.failed).toBe(0);
    expect(json.total).toBe(2);
    expect(deleteUserMock).toHaveBeenCalledTimes(2);
    expect(deleteUserMock).toHaveBeenCalledWith('u1');
    expect(deleteUserMock).toHaveBeenCalledWith('u2');
  });

  it('conta failed se auth deleteUser fallisce', async () => {
    scaduti = { data: [{ user_id: 'u1' }], error: null };
    deleteUserMock.mockResolvedValueOnce({ error: { message: 'auth fail' } });
    const res = await POST(makeReq('Bearer secret123') as never);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.failed).toBe(1);
    expect(json.errors[0]).toContain('u1');
  });

  it('un azzeramento che non passa non ferma la cancellazione dell account', async () => {
    // 3/9/2026 — Prima qui c'era il ripiego: l'azzeramento del profilo si
    // faceva in un colpo solo e, se non passava, si riprovava a pezzi. Adesso i
    // pezzi sono due dall'inizio — i dati di verifica identità prima della
    // cancellazione, quelli di vetrina dopo — quindi non c'è più un ripiego da
    // provare: se uno dei due non passa, viene scritto nel diario e la
    // cancellazione va avanti lo stesso. L'account deve sparire comunque.
    scaduti = { data: [{ user_id: 'u1' }], error: null };
    updateEqMock.mockResolvedValueOnce({ error: { message: 'colonna assente' } });
    const res = await POST(makeReq('Bearer secret123') as never);
    const json = await res.json();
    expect(json.processed).toBe(1);
    expect(deleteUserMock).toHaveBeenCalledWith('u1');
  });
});
