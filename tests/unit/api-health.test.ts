import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase admin — factory self-contained
const limitMock = vi.fn<() => Promise<{ error: null | { message: string } }>>(
  () => Promise.resolve({ error: null }),
);
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ limit: limitMock })) })),
  })),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    // L'elenco delle variabili indispensabili ora comprende anche quelle senza
    // cui il marketplace non incassa e non scrive: prima il controllo diceva
    // «a posto» con i pagamenti e la posta spenti.
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.RESEND_API_KEY = 're_test';
    process.env.CRON_SECRET = 'cron_test';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns 200 ok when DB reachable + env present', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.checks.db.ok).toBe(true);
    expect(json.checks.env.ok).toBe(true);
  });

  it('returns 503 degraded when DB query errors', async () => {
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.checks.db.ok).toBe(false);
  });

  it('returns 503 when required env missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.checks.env.ok).toBe(false);
    expect(json.checks.env.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('does NOT leak version/build/secrets', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json).not.toHaveProperty('version');
    expect(json).not.toHaveProperty('buildHash');
    expect(JSON.stringify(json)).not.toContain('svc'); // no service key leak
  });

  it('includes timestamp + latencyMs + cache-control no-store', async () => {
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.timestamp).toBeTruthy();
    expect(typeof json.latencyMs).toBe('number');
  });

  it('handles getAdminSupabase throwing (no service key)', async () => {
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getAdminSupabase).mockImplementationOnce(() => { throw new Error('No key'); });
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.checks.db.ok).toBe(false);
  });
});
