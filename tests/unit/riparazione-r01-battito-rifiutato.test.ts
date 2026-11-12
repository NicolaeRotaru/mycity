import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R01-010 — Se il battito di un lavoro non si scriveva, nessuna riga lo diceva.
 *
 * supabase-js non lancia: una scrittura rifiutata torna come `{ error }`. Il codice aspettava
 * solo un'eccezione, quindi il battito rifiutato spariva in silenzio e l'allarme «lavoro fermo»
 * che seguiva mandava a cercare un lavoro che invece girava.
 */
const { upsert, warn, error } = vi.hoisted(() => ({ upsert: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ upsert })) })),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info: vi.fn(), debug: vi.fn() } }));

import { withCronAuth } from '@/lib/api/middleware';

const richiesta = () => ({
  headers: new Headers({ authorization: 'Bearer segreto-di-prova' }),
  nextUrl: { pathname: '/api/cron/send-emails' },
  url: 'http://localhost/api/cron/send-emails',
}) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'segreto-di-prova';
});

describe('R01-010 · un battito rifiutato dal database lascia la sua riga', () => {
  it('con { error } dalla scrittura, il registro dice quale lavoro e perche\'', async () => {
    upsert.mockResolvedValue({ error: { message: 'permission denied for table cron_heartbeats' } });
    const risposta = await withCronAuth(async () => ({ status: 200 }) as never)(richiesta());
    expect((risposta as unknown as { status: number }).status).toBe(200);
    const righe = [...warn.mock.calls, ...error.mock.calls].filter((c) => /battito/.test(String(c[0])));
    expect(righe.length).toBe(1);
    expect(JSON.stringify(righe[0][1])).toMatch(/send-emails/);
    expect(JSON.stringify(righe[0][1])).toMatch(/permission denied/);
  });

  it('con la scrittura riuscita non si scrive niente', async () => {
    upsert.mockResolvedValue({ error: null });
    await withCronAuth(async () => ({ status: 200 }) as never)(richiesta());
    expect([...warn.mock.calls, ...error.mock.calls].filter((c) => /battito/.test(String(c[0])))).toEqual([]);
  });
});
