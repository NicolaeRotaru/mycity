import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * 22/8/2026 — IL FRENO SCATTAVA DOPO L'AUTENTICAZIONE.
 *
 * Il freno per utente è quello giusto per chi ha un account: due persone dietro
 * lo stesso indirizzo — un ufficio, la rete di un operatore mobile — non si
 * penalizzano a vicenda.
 *
 * Ma stava DOPO il controllo dell'identità, che per ogni richiesta fa una
 * chiamata al servizio di autenticazione e una lettura del profilo. Chi bussa
 * senza un gettone valido non arrivava mai al freno: veniva respinto dopo, e
 * ogni tentativo era comunque costato due chiamate. Diecimila tentativi al
 * minuto erano ventimila chiamate pagate da noi per respingere sempre la stessa
 * persona.
 *
 * Questa prova conta quante volte si chiede «chi sei» sotto raffica. Sposta il
 * freno dopo `authenticate` e torna rossa.
 */

const authGetUser = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: authGetUser } })),
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: vi.fn(() => ({ auth: { getUser: authGetUser }, from: vi.fn() })),
}));
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(async () => null),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({ from: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/shopping-access', () => ({ purchaseBlockReason: () => null }));

function richiesta(ip: string): NextRequest {
  return {
    headers: new Headers({
      'x-forwarded-for': ip,
      authorization: 'Bearer gettone-che-non-vale',
    }),
  } as unknown as NextRequest;
}

describe('il freno scatta prima di autenticare', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no' } });
    const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');
    __resetRateLimitBuckets();
  });

  it('sotto raffica smette di chiedere «chi sei» al servizio di autenticazione', async () => {
    const { withAuthRateLimit } = await import('@/lib/api/middleware');
    const rotta = withAuthRateLimit(
      { name: 'prova-freno', max: 5, windowMs: 60_000 },
      async () => new Response('ok') as never,
    );

    // Quattrocento tentativi con un gettone che non vale, tutti dallo stesso
    // indirizzo. Il tetto per rete è 300.
    for (let i = 0; i < 400; i++) await rotta(richiesta('203.0.113.10'));

    // Se il freno stesse dopo l'autenticazione, sarebbero 400 chiamate.
    expect(authGetUser.mock.calls.length).toBeLessThanOrEqual(310);
    expect(authGetUser.mock.calls.length).toBeGreaterThan(0);
  });

  it('la risposta oltre il tetto è 429, non 401', async () => {
    const { withAuthRateLimit } = await import('@/lib/api/middleware');
    const rotta = withAuthRateLimit(
      { name: 'prova-freno-2', max: 5, windowMs: 60_000 },
      async () => new Response('ok') as never,
    );

    let ultima: Response | null = null;
    for (let i = 0; i < 400; i++) ultima = (await rotta(richiesta('203.0.113.11'))) as unknown as Response;

    // 429 dice «rallenta»; 401 direbbe «le tue credenziali non vanno», e chi lo
    // legge continua a riprovare credendo di sbagliare password.
    expect(ultima?.status).toBe(429);
  });

  it('due indirizzi diversi non si penalizzano a vicenda', async () => {
    const { withAuthRateLimit } = await import('@/lib/api/middleware');
    const rotta = withAuthRateLimit(
      { name: 'prova-freno-3', max: 5, windowMs: 60_000 },
      async () => new Response('ok') as never,
    );

    for (let i = 0; i < 400; i++) await rotta(richiesta('198.51.100.1'));
    const altro = (await rotta(richiesta('198.51.100.2'))) as unknown as Response;

    // L'altro indirizzo non è stato frenato: arriva fino all'autenticazione, e
    // lì viene respinto perché il gettone non vale davvero.
    expect(altro.status).toBe(401);
  });
});
