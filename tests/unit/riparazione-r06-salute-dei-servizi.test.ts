/**
 * R06-023 / R06-024 (12/11/2026) — LA PAGINA PUBBLICA «STATO SERVIZI».
 *
 * R06-024: con la chiave della posta su Vercel la riga diceva «Non disponibile —
 * API non raggiungibile». Il controllo chiede a Resend l'elenco dei domini, che
 * una chiave di solo invio non puo' leggere (401 restricted_api_key), e il
 * motivo vero veniva buttato.
 *
 * Qui i controlli veri girano con la rete finta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({
  resend: { status: 200, corpo: {} as unknown },
  avvisi: [] as Array<{ msg: string; ctx?: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => false, getStripe: () => ({}) }));
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (msg: string, ctx?: unknown) => { stato.avvisi.push({ msg, ctx }); },
    error: () => {}, info: () => {}, debug: () => {},
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) }),
}));

beforeEach(() => {
  stato.avvisi.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_finta');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://progetto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-anonima');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('api.resend.com')) {
      return new Response(JSON.stringify(stato.resend.corpo), { status: stato.resend.status });
    }
    return new Response('{}', { status: 200 });
  }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function riga(id: string) {
  const { getSystemHealth } = await import('@/lib/health/checks');
  const salute = await (getSystemHealth as unknown as () => Promise<{ services: Array<{ id: string; status: string; detail: string | null }> }>)();
  return salute.services.find((s) => s.id === id)!;
}

describe('R06-024 · la riga della posta', () => {
  it('una chiave di solo invio (401 restricted_api_key) non e\' un guasto', async () => {
    stato.resend = { status: 401, corpo: { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } };
    const email = await riga('email');
    expect(email.status, 'La pagina pubblica annunciava che le email non partono, con una chiave valida').toBe('operational');
  });

  it('un guasto vero dice il motivo, nella riga e nei log', async () => {
    stato.resend = { status: 500, corpo: { message: 'errore' } };
    const email = await riga('email');
    expect(email.status).toBe('outage');
    expect(email.detail, 'Il motivo vero veniva buttato: la riga diceva solo una frase fissa').toContain('HTTP 500');
    expect(stato.avvisi.some((a) => JSON.stringify(a).includes('HTTP 500'))).toBe(true);
  });

  it('un 401 con un altro motivo (chiave sbagliata) resta un guasto', async () => {
    stato.resend = { status: 401, corpo: { name: 'validation_error', message: 'API key is invalid' } };
    const email = await riga('email');
    expect(email.status).toBe('outage');
    expect(email.detail).toContain('HTTP 401');
  });
});
