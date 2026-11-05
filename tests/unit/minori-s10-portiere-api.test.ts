import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S10 (5/11/2026) — il portiere delle rotte API (lib/api/middleware.ts) e il
 * controllo di provenienza (lib/api/provenienza.ts).
 * 2002: senza chiave di servizio il limite per persona scatta lo stesso.
 * 2010: un guasto nella lettura del profilo è 503, non «Profilo non trovato».
 * 217: Origin «null» su un metodo che scrive vale come un altro sito.
 * 601: i lavori automatici rifiutati lasciano una riga d'errore.
 */

const MARIA = { id: 'u-1', email: 'maria@example.com' };
const stato = {
  senzaChiave: true,
  erroreProfilo: null as null | { code: string; message: string },
};
const erroreLog = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.single = async () =>
      stato.erroreProfilo ? { data: null, error: stato.erroreProfilo } : { data: { id: 'u-1', role: 'buyer', is_approved: true }, error: null };
    return { from: () => q };
  },
  getCurrentUser: async () => null,
  getServerSupabase: async () => ({ client: 'coi-cookie' }),
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (g: string) =>
        g === 'gettone-di-maria' ? { data: { user: MARIA }, error: null } : { data: { user: null }, error: { message: 'x' } },
    },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => erroreLog(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));

import { POST as chiediCancellazione } from '@/app/api/account/delete/route';
import { withAuth, withCronAuth } from '@/lib/api/middleware';
import { arrivaDaUnAltroSito } from '@/lib/api/provenienza';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { NextResponse } from 'next/server';

const CTX = { params: Promise.resolve({}) } as never;
const conMaria = (metodo: string, url: string) =>
  new Request(`http://localhost${url}`, { method: metodo, headers: { authorization: 'Bearer gettone-di-maria' } }) as never;

beforeEach(() => {
  stato.senzaChiave = true;
  stato.erroreProfilo = null;
  erroreLog.mockClear();
  __resetRateLimitBuckets();
});

describe('senza chiave il limite per persona vale lo stesso (2002)', () => {
  it('alla quarta richiesta di cancellazione nell\'ora: 429', async () => {
    const stati: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = (await (chiediCancellazione as unknown as (r: never, c: never) => Promise<Response>)(
        conMaria('POST', '/api/account/delete'),
        CTX,
      )) as Response;
      stati.push(r.status);
    }
    expect(stati.slice(0, 3)).toEqual([503, 503, 503]);
    expect(stati[3]).toBe(429);
  });
});

describe('un guasto del profilo non è «Profilo non trovato» (2010)', () => {
  const rotta = withAuth(async () => NextResponse.json({ ok: true })) as unknown as (r: never, c: never) => Promise<Response>;
  it('errore del database → 503', async () => {
    stato.senzaChiave = false;
    stato.erroreProfilo = { code: '57014', message: 'canceling statement due to statement timeout' };
    const r = await rotta(conMaria('GET', '/api/x'), CTX);
    expect(r.status).toBe(503);
  });
  it('nessuna riga (PGRST116) → 403 come prima', async () => {
    stato.senzaChiave = false;
    stato.erroreProfilo = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
    const r = await rotta(conMaria('GET', '/api/x'), CTX);
    expect(r.status).toBe(403);
  });
});

describe('Origin «null» non passa sui metodi che scrivono (217)', () => {
  const req = (origin: string | null, method = 'POST') => ({
    method,
    url: 'https://mycity-marketplace.com/api/x',
    headers: { get: (n: string) => (n.toLowerCase() === 'origin' ? origin : n.toLowerCase() === 'host' ? 'mycity-marketplace.com' : null) },
  });
  it('POST con Origin: null → altro sito', () => {
    expect(arrivaDaUnAltroSito(req('null'))).toBe(true);
  });
  it('POST senza Origin → come prima, passa', () => {
    expect(arrivaDaUnAltroSito(req(null))).toBe(false);
  });
  it('GET con Origin: null → passa (legge soltanto)', () => {
    expect(arrivaDaUnAltroSito(req('null', 'GET'))).toBe(false);
  });
});

describe('i lavori automatici rifiutati lasciano una riga (601)', () => {
  const lavoro = withCronAuth(async () => NextResponse.json({ ok: true }));
  it('CRON_SECRET assente → riga d\'errore', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await lavoro(new Request('http://localhost/api/cron/prova') as never);
    expect(r.status).toBe(503);
    expect(erroreLog).toHaveBeenCalledWith(expect.stringMatching(/CRON_SECRET assente/), expect.anything());
  });
  it('segreto diverso → riga d\'errore, senza il segreto', async () => {
    vi.stubEnv('CRON_SECRET', 'segreto-vero');
    const r = await lavoro(new Request('http://localhost/api/cron/prova', { headers: { authorization: 'Bearer altro' } }) as never);
    expect(r.status).toBe(401);
    expect(erroreLog).toHaveBeenCalledWith(expect.stringMatching(/segreto diverso/), expect.anything());
    expect(JSON.stringify(erroreLog.mock.calls)).not.toContain('segreto-vero');
  });
});
