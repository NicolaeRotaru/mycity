import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'node:child_process';

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser,
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'u1', role: 'admin', is_approved: true } })) })),
      })),
    })),
  })),
}));

import {
  withAuth,
  withAuthRateLimit,
  withSellerAuth,
  withSellerAuthRateLimit,
  withAdminAuth,
  withAdminAuthRateLimit,
} from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * 30/8/2026 (R017) — TREDICI ROTTE RISCRIVEVANO A MANO LO STESSO ADATTATORE.
 *
 * In Next 15 i pezzi dell'indirizzo — la `[id]` di `/api/orders/[id]/cancel` —
 * arrivano come PROMESSA, nel secondo argomento della rotta. I nostri involucri
 * di autenticazione quel secondo argomento non lo prendevano nemmeno: la loro
 * firma era `(req)` e basta. Cosi' ogni rotta dinamica si riscriveva la stessa
 * riga per conto suo, e ognuna di quelle copie era un'occasione per dimenticare
 * l'`await`:
 *
 *   export const DELETE = (req, ctx) =>
 *     withAdminAuthRateLimit({...}, async ({ user }) =>
 *       handler(req, user, { params: await ctx.params }))(req);
 *
 * Dimenticato l'`await`, `params.id` diventa `undefined` e finisce dritto in una
 * query — su rotte come la cancellazione di un utente o la risoluzione di una
 * contestazione. Non e' un difetto ipotetico: e' una riga lunga, copiata a mano
 * tredici volte, che nessun tipo obbligava a scrivere giusta.
 *
 * Adesso i parametri li risolve l'involucro, una volta, e arrivano al gestore
 * gia' pronti.
 */

function richiesta(percorso = '/api/prova'): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }),
    nextUrl: { pathname: percorso },
    url: `http://localhost${percorso}`,
  } as unknown as NextRequest;
}

const involucri: Array<[string, (h: never) => (req: NextRequest, ctx?: never) => Promise<NextResponse>]> = [
  ['withAuth', (h) => withAuth(h)],
  ['withAuthRateLimit', (h) => withAuthRateLimit({ name: 'prova-a', max: 100, windowMs: 60_000 }, h)],
  ['withSellerAuth', (h) => withSellerAuth(h)],
  ['withSellerAuthRateLimit', (h) => withSellerAuthRateLimit({ name: 'prova-b', max: 100, windowMs: 60_000 }, h)],
  ['withAdminAuth', (h) => withAdminAuth(h)],
  ['withAdminAuthRateLimit', (h) => withAdminAuthRateLimit({ name: 'prova-c', max: 100, windowMs: 60_000 }, h)],
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  getCurrentUser.mockResolvedValue({ id: 'u1' });
});

describe('gli involucri di autenticazione e i pezzi dell indirizzo', () => {
  it.each(involucri)('%s consegna al gestore la [id] gia risolta', async (_nome, avvolgi) => {
    let visti: unknown = 'il gestore non e stato chiamato';
    const gestore = (async (ctx: { params: Record<string, unknown> }) => {
      visti = ctx.params;
      return { ok: true } as unknown as NextResponse;
    }) as never;

    await avvolgi(gestore)(richiesta('/api/orders/abc-123/cancel'), {
      params: Promise.resolve({ id: 'abc-123' }),
    } as never);

    expect(
      visti,
      'Il gestore ha ricevuto una promessa (o niente) al posto del valore: e la riga che ogni rotta dinamica doveva riscriversi da sola',
    ).toEqual({ id: 'abc-123' });
  });

  it.each(involucri)('%s non si rompe su una rotta senza pezzi nell indirizzo', async (_nome, avvolgi) => {
    let visti: unknown = null;
    const gestore = (async (ctx: { params: Record<string, unknown> }) => {
      visti = ctx.params;
      return { ok: true } as unknown as NextResponse;
    }) as never;

    await avvolgi(gestore)(richiesta('/api/account'));

    expect(visti, 'una rotta statica deve ricevere un elenco vuoto, non undefined').toEqual({});
  });
});

describe('nessuna rotta si riscrive piu l adattatore a mano', () => {
  it('nessuna rotta si avvolge piu passando il secondo argomento di Next a mano', () => {
    // La forma esatta dell'adattatore duplicato: una rotta esportata come
    // freccia che prende `ctx` e poi chiama l'involucro con `(req)` in fondo.
    // Il conto del 30/8: 15 righe cosi', in 12 file. Ogni copia era un posto
    // dove dimenticare l'`await` e passare `undefined` a una query — la
    // cancellazione di un utente, la risoluzione di una contestazione.
    //
    // Le rotte NON avvolte (quelle pubbliche, che Next chiama diretto) tengono
    // giustamente la firma di Next: qui non c'entrano, e infatti la forma
    // cercata e' `export const X = (req, ctx) =>`, non la funzione esportata.
    const trovate = execSync(
      String.raw`grep -rnE "^export const [A-Z]+ = \(req: NextRequest, ctx:" app/api || true`,
      { encoding: 'utf8' },
    ).trim();
    expect(trovate, `Righe che riscrivono ancora l'adattatore a mano:\n${trovate}`).toBe('');
  });
});
