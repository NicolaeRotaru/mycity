import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-001 — Se Resend rifiuta l'email di conferma della newsletter, il rifiuto resta scritto.
 * La persona riceve la stessa risposta di sempre; cambia solo che qualcuno può accorgersene.
 */

const registro = vi.hoisted(() => ({ errori: [] as Array<[string, unknown]> }));
const posta = vi.hoisted(() => ({ esito: { ok: true, id: 'em_1' } as Record<string, unknown> }));

vi.mock('@/lib/funzioni-al-lancio', async (o) => ({ ...((await o()) as Record<string, unknown>), NEWSLETTER_ACCESA: true }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.insert = async () => ({ error: null });
    q.update = () => q;
    return { from: () => q };
  },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => posta.esito }));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: (m: string, d: unknown) => registro.errori.push([m, d]), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));

import { POST } from '@/app/api/newsletter/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiama = () =>
  POST(new Request('https://mycity.test/api/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ email: 'ada@example.com' }),
  }) as never);

beforeEach(() => {
  registro.errori.length = 0;
  __resetRateLimitBuckets();
});

describe('R03-001 — la newsletter guarda l esito dell invio', () => {
  it('Resend rifiuta: risposta ok identica, ma il rifiuto è registrato senza l indirizzo', async () => {
    posta.esito = { ok: false, error: 'You have reached your daily email quota' };
    const r = await chiama();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(registro.errori).toHaveLength(1);
    expect(JSON.stringify(registro.errori[0])).toContain('quota');
    expect(JSON.stringify(registro.errori[0])).not.toContain('ada@example.com');
  });

  it('email partita: niente nel registro degli errori', async () => {
    posta.esito = { ok: true, id: 'em_1' };
    const r = await chiama();
    expect(r.status).toBe(200);
    expect(registro.errori).toHaveLength(0);
  });
});
