import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R30-009 — se l'abbonamento Supabase scade, la trasformazione delle foto risponde 403 e la vetrina
 * resta senza foto. La rotta di salute chiede una foto vera di un prodotto in vendita e lo dice:
 * `degraded` con 200 (non fatale), e `checks.foto` nel corpo dettagliato. La rete è finta.
 */

const FOTO = 'https://x.supabase.co/storage/v1/object/public/products/negozio/foto.jpg';
const state: { immagini: unknown[] } = { immagini: [] };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') return { select: () => Promise.resolve({ data: tuttiVivi(), error: null }) };
      if (tabella === 'products') {
        const catena = {
          eq: () => catena,
          not: () => catena,
          limit: () => Promise.resolve({ data: state.immagini.map((images) => ({ images })), error: null }),
        };
        return { select: () => catena };
      }
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function tuttiVivi() {
  const adesso = new Date(Date.now() - 60_000).toISOString();
  return [
    'release-payouts', 'send-emails', 'send-push', 'expire-checkouts', 'expire-stale-orders', 'abandoned-carts',
    'process-deletions', 'external-price-alerts', 'riquadra-casse', 'veloce-non-confermata', 'operational-alerts',
  ].map((name) => ({ name, last_run_at: adesso }));
}

let contatore = 0;
async function salute() {
  contatore++;
  const res = await GET(new Request('https://mycity.test/api/health', { headers: { 'x-forwarded-for': `10.9.0.${contatore % 250}` } }));
  return { stato: res.status, corpo: await res.json() };
}

describe('R30-009 — la rotta di salute guarda anche le foto', () => {
  const salvato = { ...process.env };
  let rete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    __resetRateLimitBuckets();
    state.immagini = [['https://images.pexels.com/photos/1/a.jpg', FOTO]];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    Object.assign(process.env, { SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    for (const k of [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET', 'RESEND_API_KEY', 'RESEND_FROM', 'CRON_SECRET',
      'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'INTERNAL_API_SECRET',
      'UNSUBSCRIBE_SECRET', 'MIDDLEWARE_CACHE_SECRET', 'SUPPORT_EMAIL', 'TURNSTILE_SECRET_KEY',
      'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AI_GLOBAL_DAILY_BUDGET_EUR',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ]) process.env[k] = 'x';
    rete = vi.fn(async () => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', rete);
  });

  afterEach(() => {
    process.env = { ...salvato };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('la trasformazione risponde 403: degradato con 200, e checks.foto lo dice', async () => {
    rete.mockImplementation(async () => new Response('x', { status: 403 }));
    const { stato, corpo } = await salute();
    expect(stato).toBe(200);
    expect(corpo.status).toBe('degraded');
    expect(corpo.checks.foto).toMatchObject({ ok: false, stato: 'degradato' });
    expect(String(rete.mock.calls[0][0])).toContain('/storage/v1/render/image/public/products/negozio/foto.jpg');
  });

  it('la trasformazione risponde 200: verde', async () => {
    const { stato, corpo } = await salute();
    expect(stato).toBe(200);
    expect(corpo.status, JSON.stringify(corpo.checks)).toBe('ok');
    expect(corpo.checks.foto).toMatchObject({ ok: true, stato: 'ok' });
  });

  it('nessuna foto dello Storage da chiedere: il controllo si salta, nessuna richiesta', async () => {
    state.immagini = [['https://images.pexels.com/photos/1/a.jpg']];
    const { corpo } = await salute();
    expect(corpo.status).toBe('ok');
    expect(corpo.checks.foto).toBeUndefined();
    expect(rete).not.toHaveBeenCalled();
  });
});
