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
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** Una richiesta finta con un indirizzo di rete diverso per ogni caso, così il
 *  freno di 60/minuto non fa fallire il caso successivo. */
let contatore = 0;
function req(headers: Record<string, string> = {}): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: { 'x-forwarded-for': `10.0.0.${contatore % 250}`, ...headers },
  });
}

describe('GET /api/health', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    limitMock.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.RESEND_API_KEY = 're_test';
    process.env.CRON_SECRET = 'cron_test';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('risponde 200 ok quando il database risponde e le variabili ci sono', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.checks.db.ok).toBe(true);
    expect(json.checks.env.ok).toBe(true);
  });

  it('risponde 503 quando il database non risponde: quello sì è fatale', async () => {
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    const res = await GET(req());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.checks.db.ok).toBe(false);
  });

  it('risponde 503 se manca una variabile senza cui il sito non serve pagine', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.checks.env.ok).toBe(false);
  });

  // 176 + 234 — Questo è il caso che prima faceva spegnere il sito: senza la
  // chiave della posta rispondeva 503, e per Render 503 su questa rotta vuol
  // dire «istanza morta». Il marketplace vende benissimo senza spedire email.
  it('senza la chiave delle email dice «degradato» ma risponde 200: Render non deve spegnere niente', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
  });

  // 021 + 238 — La risposta pubblica non è una mappa di dove il sito è scoperto.
  it('in produzione non dice a un anonimo quali segreti mancano', async () => {
    const prima = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const res = await GET(req());
      const testo = JSON.stringify(await res.json());
      expect(testo).not.toContain('STRIPE_SECRET_KEY');
      expect(testo).not.toContain('checks');
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prima, configurable: true });
    }
  });

  it('in produzione il dettaglio lo vede chi ha il segreto dei cron', async () => {
    const prima = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    try {
      const res = await GET(req({ authorization: 'Bearer cron_test' }));
      const json = await res.json();
      expect(json.checks).toBeTruthy();
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prima, configurable: true });
    }
  });

  // 021 — il freno: la rotta interroga il database a ogni chiamata.
  it('oltre le 60 chiamate al minuto dallo stesso indirizzo risponde 429', async () => {
    const stesso = () => new Request('https://mycity.test/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    for (let i = 0; i < 60; i++) await GET(stesso());
    const res = await GET(stesso());
    expect(res.status).toBe(429);
  });

  it('non trapela la chiave di servizio', async () => {
    const res = await GET(req());
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain('svc');
  });

  it('mette timestamp, latenza e cache-control no-store', async () => {
    const res = await GET(req());
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.timestamp).toBeTruthy();
    expect(typeof json.latencyMs).toBe('number');
  });
});
