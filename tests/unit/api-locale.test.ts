import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/locale/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/locale', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/locale', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts valid locale "en" and sets cookie', async () => {
    const res = await POST(makeReq({ locale: 'en' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.locale).toBe('en');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('NEXT_LOCALE=en');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie.toLowerCase()).toContain('path=/');
  });

  it('accepts valid locale "it"', async () => {
    const res = await POST(makeReq({ locale: 'it' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.locale).toBe('it');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('NEXT_LOCALE=it');
  });

  it('rejects unsupported locale (de)', async () => {
    const res = await POST(makeReq({ locale: 'de' }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/unsupported/i);
  });

  it('rejects empty body', async () => {
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('rejects non-string locale (number)', async () => {
    const res = await POST(makeReq({ locale: 42 }) as never);
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await POST(makeReq('{not-json') as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it('cookie has 1-year maxAge', async () => {
    const res = await POST(makeReq({ locale: 'en' }) as never);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.toLowerCase()).toMatch(/max-age=315/); // 31_536_000 sec
  });

  it('cookie is not httpOnly (UI needs to read it)', async () => {
    const res = await POST(makeReq({ locale: 'en' }) as never);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.toLowerCase()).not.toContain('httponly');
  });
});
