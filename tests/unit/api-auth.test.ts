import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase auth - factory self-contained
const signUpMock = vi.fn();
const signInMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  auth: {
    signUp: (...args: unknown[]) => signUpMock(...args),
    signIn: (...args: unknown[]) => signInMock(...args),
    signOut: () => signOutMock(),
  },
}));

vi.mock('@/lib/captcha', () => ({
  verifyTurnstileToken: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'http://localhost:3000' },
}));

import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { POST as signinPOST } from '@/app/api/auth/signin/route';

function makeReq(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/auth/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUpMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects invalid JSON body', async () => {
    const res = await signupPOST(makeReq('{', '9.0.0.1') as never);
    expect(res.status).toBe(400);
  });

  it('rejects invalid email format', async () => {
    const res = await signupPOST(makeReq({ email: 'not-an-email', password: 'longenough123', captchaToken: 't' }, '9.0.0.2') as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error?.message).toMatch(/Email/);
  });

  it('rejects short password (<8 char)', async () => {
    const res = await signupPOST(makeReq({ email: 'a@b.com', password: 'short', captchaToken: 't' }, '9.0.0.3') as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error?.message).toMatch(/8 caratteri/);
  });

  it('rejects too long email (>254 char)', async () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    const res = await signupPOST(makeReq({ email: longEmail, password: 'goodpassword1', captchaToken: 't' }, '9.0.0.4') as never);
    expect(res.status).toBe(400);
  });

  it('calls auth.signUp with normalized email + emailRedirectTo', async () => {
    await signupPOST(makeReq({ email: '  TEST@Example.com  ', password: 'goodpassword1', captchaToken: 't' }, '9.0.0.5') as never);
    expect(signUpMock).toHaveBeenCalledWith(
      'test@example.com',
      'goodpassword1',
      expect.objectContaining({ captchaToken: 't', emailRedirectTo: 'http://localhost:3000/auth/callback' }),
    );
  });

  it('returns 201 with user data when signup succeeds', async () => {
    const res = await signupPOST(makeReq({ email: 'new@user.com', password: 'goodpassword1', captchaToken: 't' }, '9.0.0.6') as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user?.id).toBe('u1');
  });

  it('returns 400 when supabase signup fails', async () => {
    signUpMock.mockResolvedValueOnce({ data: null, error: { message: 'Email already exists' } });
    const res = await signupPOST(makeReq({ email: 'exists@user.com', password: 'goodpassword1', captchaToken: 't' }, '9.0.0.7') as never);
    expect(res.status).toBe(400);
  });

  it('rate limits after 5 signup attempts from same IP', async () => {
    const ip = '9.99.99.99';
    for (let i = 0; i < 5; i++) {
      const r = await signupPOST(makeReq({ email: `u${i}@x.com`, password: 'goodpassword1', captchaToken: 't' }, ip) as never);
      expect(r.status).toBeLessThan(429);
    }
    const blocked = await signupPOST(makeReq({ email: 'u6@x.com', password: 'goodpassword1', captchaToken: 't' }, ip) as never);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('POST /api/auth/signin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com', email_confirmed_at: new Date().toISOString() } }, error: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects invalid JSON', async () => {
    const res = await signinPOST(makeReq('{bad', '8.0.0.1') as never);
    expect(res.status).toBe(400);
  });

  it('rejects invalid email', async () => {
    const res = await signinPOST(makeReq({ email: 'invalid', password: 'pw1234', captchaToken: 't' }, '8.0.0.2') as never);
    expect(res.status).toBe(400);
  });

  it('rejects password too short (<6 char)', async () => {
    const res = await signinPOST(makeReq({ email: 'a@b.com', password: '12345', captchaToken: 't' }, '8.0.0.3') as never);
    expect(res.status).toBe(400);
  });

  it('returns 401 when supabase signin fails', async () => {
    signInMock.mockResolvedValueOnce({ data: null, error: { message: 'Invalid credentials' } });
    const res = await signinPOST(makeReq({ email: 'a@b.com', password: 'wrongpass', captchaToken: 't' }, '8.0.0.4') as never);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error?.message).toMatch(/Email o password/);
  });

  it('returns 403 with EMAIL_NOT_VERIFIED when user.email_confirmed_at is null', async () => {
    signInMock.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'unconf@b.com', email_confirmed_at: null } },
      error: null,
    });
    const res = await signinPOST(makeReq({ email: 'unconf@b.com', password: 'pass123', captchaToken: 't' }, '8.0.0.5') as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it('returns 200 with user on successful signin', async () => {
    const res = await signinPOST(makeReq({ email: 'a@b.com', password: 'pass123', captchaToken: 't' }, '8.0.0.6') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user?.id).toBe('u1');
  });

  it('rate limits after 10 signin attempts from same IP', async () => {
    signInMock.mockResolvedValue({ data: null, error: { message: 'bad' } });
    const ip = '7.77.77.77';
    for (let i = 0; i < 10; i++) {
      const r = await signinPOST(makeReq({ email: `u${i}@x.com`, password: 'pass123', captchaToken: 't' }, ip) as never);
      expect(r.status).toBeLessThan(429);
    }
    const blocked = await signinPOST(makeReq({ email: 'u11@x.com', password: 'pass123', captchaToken: 't' }, ip) as never);
    expect(blocked.status).toBe(429);
  });

  it('normalizes email (lowercase + trim)', async () => {
    await signinPOST(makeReq({ email: '  MIXED@Case.COM  ', password: 'pass123', captchaToken: 't' }, '8.0.0.7') as never);
    expect(signInMock).toHaveBeenCalledWith(
      'mixed@case.com',
      'pass123',
      expect.objectContaining({ captchaToken: 't' }),
    );
  });
});
