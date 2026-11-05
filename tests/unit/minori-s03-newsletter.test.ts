import { describe, it, expect, vi, beforeEach } from 'vitest';

/** S03 — l'iscrizione alla newsletter (schede 1842, 1843). Impianto come la-newsletter-non-riempie-la-casella-di-un-estraneo. */
type Riga = { id: string; confirmed_at: string | null; created_at: string; active?: boolean | null };
const stato = vi.hoisted(() => ({
  riga: null as null | Record<string, unknown>,
  erroreLettura: null as null | { message: string },
  erroreScrittura: null as null | { message: string; code?: string },
}));
const insertMock = vi.fn(async (_r: Record<string, unknown>) => ({ error: stato.erroreScrittura }));
const updateMock = vi.fn(async (_r: Record<string, unknown>) => ({ error: stato.erroreScrittura }));
const sendEmailMock = vi.fn(async (_a: unknown) => ({ ok: true }));

vi.mock('@/lib/funzioni-al-lancio', async (o) => ({ ...((await o()) as Record<string, unknown>), NEWSLETTER_ACCESA: true }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.riga, error: stato.erroreLettura }) }) }),
      insert: (r: Record<string, unknown>) => insertMock(r),
      update: (r: Record<string, unknown>) => ({ eq: async () => updateMock(r) }),
    }),
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: (a: unknown) => sendEmailMock(a) }));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));

import { POST } from '@/app/api/newsletter/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let ip = 0;
const iscrizione = () =>
  POST(new Request('http://localhost/api/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.1.0.${++ip}` },
    body: JSON.stringify({ email: 'luca@example.com', captchaToken: 'ok' }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  stato.riga = null; stato.erroreLettura = null; stato.erroreScrittura = null;
});

describe('newsletter', () => {
  it('1842 — la lettura che cade non va all insert: risponde «non disponibile»', async () => {
    stato.erroreLettura = { message: 'timeout' };
    const r = await iscrizione();
    expect(r.status).toBe(503);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('1842 — due richieste insieme: il vincolo UNIQUE non diventa un 500', async () => {
    stato.erroreScrittura = { message: 'duplicate key', code: '23505' };
    const r = await iscrizione();
    expect(r.status).toBe(200);
  });

  it('1843 — chi si era disiscritto e torna riceve una conferma nuova', async () => {
    const riga: Riga = { id: 'n1', confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', active: false };
    stato.riga = riga;
    const r = await iscrizione();
    expect(r.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ confirmed_at: null, active: false });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('1843 — controprova: confermato e attivo, nessuna email', async () => {
    stato.riga = { id: 'n1', confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', active: true };
    await iscrizione();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
