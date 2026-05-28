import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase server + email — factory self-contained
const insertMock = vi.fn<(arg: Record<string, unknown>) => Promise<{ error: null | { message: string } }>>(
  () => Promise.resolve({ error: null }),
);
const getCurrentUserMock = vi.fn<() => Promise<{ id: string } | null>>(() => Promise.resolve(null));
const sendEmailMock = vi.fn<(arg: unknown) => Promise<{ ok: boolean }>>(() => Promise.resolve({ ok: true }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ insert: insertMock })) })),
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock('@/lib/email/client', () => ({
  sendEmail: (arg: unknown) => sendEmailMock(arg),
}));

import { POST } from '@/app/api/contact/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown, ip = '5.0.0.1'): Request {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = {
  name: 'Mario Rossi',
  email: 'mario@example.com',
  subject: 'Domanda',
  message: 'Questo è un messaggio di test abbastanza lungo.',
};

describe('POST /api/contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    insertMock.mockResolvedValue({ error: null });
  });

  it('rejects invalid JSON', async () => {
    const res = await POST(makeReq('{bad', '5.0.1.1'));
    expect(res.status).toBe(400);
  });

  it('rejects short name', async () => {
    const res = await POST(makeReq({ ...validBody, name: 'M' }, '5.0.1.2'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid email', async () => {
    const res = await POST(makeReq({ ...validBody, email: 'not-email' }, '5.0.1.3'));
    expect(res.status).toBe(400);
  });

  it('rejects short message (<10 char)', async () => {
    const res = await POST(makeReq({ ...validBody, message: 'corto' }, '5.0.1.4'));
    expect(res.status).toBe(400);
  });

  it('inserts message and returns ok on valid input', async () => {
    const res = await POST(makeReq(validBody, '5.0.1.5'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      name: 'Mario Rossi',
      email: 'mario@example.com',
      ip: '5.0.1.5',
    });
  });

  it('honeypot (company filled) → fake success senza insert', async () => {
    const res = await POST(makeReq({ ...validBody, company: 'BotCorp' }, '5.0.1.6'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rate limits after 3 messages from same IP', async () => {
    const ip = '5.99.99.99';
    for (let i = 0; i < 3; i++) {
      const r = await POST(makeReq(validBody, ip));
      expect(r.status).toBe(200);
    }
    const blocked = await POST(makeReq(validBody, ip));
    expect(blocked.status).toBe(429);
  });

  it('returns 500 when DB insert fails', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'DB down' } });
    const res = await POST(makeReq(validBody, '5.0.1.7'));
    expect(res.status).toBe(500);
  });

  it('email sending is best-effort (non blocca su throw)', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('Resend down'));
    const res = await POST(makeReq(validBody, '5.0.1.8'));
    // Insert riuscito → 200 anche se email fallisce
    expect(res.status).toBe(200);
  });
});
