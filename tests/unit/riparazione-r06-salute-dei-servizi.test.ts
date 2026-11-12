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
  /** Quante volte risponde male l'accesso prima di rispondere bene. */
  accessoCadute: 0,
  chiamateAccesso: 0,
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
// Senza SUPABASE_SERVICE_ROLE_KEY il client amministrativo lancia, come in produzione.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => { throw new Error('Service role Supabase non configurato'); },
}));
// Il catalogo legge con la chiave pubblica, e il database risponde.
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) }),
}));

beforeEach(() => {
  stato.avvisi.length = 0;
  stato.accessoCadute = 0;
  stato.chiamateAccesso = 0;
  vi.stubEnv('RESEND_API_KEY', 're_finta');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://progetto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-anonima');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/auth/v1/health')) {
      stato.chiamateAccesso += 1;
      if (stato.chiamateAccesso <= stato.accessoCadute) throw new Error('The operation was aborted due to timeout');
      return new Response('{}', { status: 200 });
    }
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

describe('R06-023 · la pagina pubblica non annuncia guasti che non ci sono', () => {
  async function salute() {
    const { getSystemHealth } = await import('@/lib/health/checks');
    return (getSystemHealth as unknown as () => Promise<{ overall: string; services: Array<{ id: string; status: string; detail: string | null }> }>)();
  }

  it('senza la chiave di servizio il database e\' operativo, come per il catalogo', async () => {
    const s = await salute();
    const db = s.services.find((x) => x.id === 'db')!;
    expect(db.status, 'La pagina pubblica scriveva «Database: Non disponibile» per una chiave di servizio mancante').toBe('operational');
    expect(s.services.find((x) => x.id === 'realtime')!.status).toBe('operational');
  });

  it('un solo sforamento sull\'accesso e\' «rallentato», non «non disponibile»', async () => {
    stato.accessoCadute = 1;
    const s = await salute();
    const auth = s.services.find((x) => x.id === 'auth')!;
    expect(auth.status, 'Un solo tempo scaduto annunciava a tutti l\'accesso fuori servizio').toBe('degraded');
    expect(stato.chiamateAccesso).toBe(2);
  });

  it('due sforamenti di fila: allora si', async () => {
    stato.accessoCadute = 2;
    const s = await salute();
    expect(s.services.find((x) => x.id === 'auth')!.status).toBe('outage');
  });

  it('il messaggio per lo sviluppatore sui dati del titolare non esce sulla pagina pubblica', async () => {
    const s = await salute();
    const t = s.services.find((x) => x.id === 'titolare')!;
    expect(t.detail ?? '').not.toMatch(/ricompilare|variabili/i);
  });
});
