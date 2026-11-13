import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R22-001 · R22-011 — Dopo un timeout di Resend la coda non spedisce due volte la stessa email.
 *
 * Il giro vero (app/api/cron/send-emails) con il vero lib/email/client.ts e il vero SDK resend:
 * finta è solo la risposta del servizio di posta (fetch), che fa quello che fa Resend con
 * `Idempotency-Key` (stessa chiave e stesso corpo: la risposta di prima, niente nuovo invio;
 * stessa chiave e corpo diverso: 409). Nessuna email vera.
 */

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));

type RigaCoda = { id: string; user_id: string; template: string; attempts?: number; scade_at?: string | null };
let coda: RigaCoda[] = [];
let profili: Array<{ id: string; full_name?: string | null; email_marketing: boolean | null }> = [];
const scritture: Array<{ tabella: string; valori: Record<string, unknown>; chiave: unknown }> = [];

function finto() {
  return {
    rpc: async (nome: string) => (nome === 'claim_pending_emails' ? { data: coda, error: null } : { data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'giulia@example.it' } }, error: null }) } },
    from: (tabella: string) => ({
      select: () => ({ in: async () => ({ data: tabella === 'profiles' ? profili : [], error: null }) }),
      update: (valori: Record<string, unknown>) => ({
        eq: async (_colonna: string, chiave: unknown) => {
          scritture.push({ tabella, valori, chiave });
          return { error: null };
        },
      }),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

/** Il servizio di posta finto: conta le email che escono davvero. */
const consegnate: Array<{ corpo: string; chiave: string | null }> = [];
const perChiave = new Map<string, { corpo: string; id: string }>();
const accessi: Array<string | null> = [];
let lenta = false;

const servizioDiPosta = async (_url: unknown, init?: RequestInit): Promise<Response> => {
  const intestazioni = new Headers(init?.headers);
  accessi.push(intestazioni.get('authorization'));
  const chiave = intestazioni.get('idempotency-key');
  const corpo = String(init?.body ?? '');
  const prima = chiave ? perChiave.get(chiave) : undefined;
  if (prima) {
    if (prima.corpo !== corpo) {
      return new Response(JSON.stringify({ name: 'invalid_idempotent_request', message: 'stessa chiave, corpo diverso' }), { status: 409 });
    }
    return new Response(JSON.stringify({ id: prima.id }), { status: 200 });
  }
  const id = `msg-${consegnate.length + 1}`;
  consegnate.push({ corpo, chiave });
  if (chiave) perChiave.set(chiave, { corpo, id });
  // Resend l'ha presa e spedita, ma la risposta non torna entro i dieci secondi.
  if (lenta) return new Promise<Response>(() => {});
  return new Response(JSON.stringify({ id }), { status: 200 });
};

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  const p = (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
  await vi.advanceTimersByTimeAsync(12_000);
  return (await p).json() as Promise<Record<string, number>>;
}
const scritturaDi = (id: string) => scritture.filter((s) => s.tabella === 'email_queue' && s.chiave === id);
const GIORNO = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T09:00:00Z'));
  vi.stubGlobal('fetch', servizioDiPosta);
  coda = [];
  profili = [{ id: 'u1', full_name: 'Giulia Bianchi', email_marketing: true }];
  scritture.length = 0;
  consegnate.length = 0;
  accessi.length = 0;
  perChiave.clear();
  lenta = false;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Primo giro: Resend spedisce ma risponde oltre i dieci secondi. Secondo giro, cinque minuti dopo. */
async function timeoutPoiRiprova(template: string) {
  const riga: RigaCoda = { id: 'q1', user_id: 'u1', template, attempts: 0, scade_at: new Date(Date.now() + 2 * GIORNO).toISOString() };
  coda = [riga];
  lenta = true;
  const primo = await giroDellaPosta();
  expect(primo.errors, 'il primo giro doveva vedere il timeout').toBe(1);
  const rinvio = scritturaDi('q1').find((s) => s.valori.attempts === 1);
  expect(rinvio, 'la riga doveva tornare in coda col tentativo contato').toBeTruthy();

  lenta = false;
  vi.setSystemTime(new Date(Date.parse(String(rinvio!.valori.send_at)) + 1_000));
  coda = [{ ...riga, attempts: 1 }];
  const secondo = await giroDellaPosta();
  return { primo, secondo };
}

describe('dopo un timeout di Resend la riga ripresa non spedisce una seconda email', () => {
  it('il benvenuto di Giulia esce una volta sola, e la riga si chiude come spedita', async () => {
    const { secondo } = await timeoutPoiRiprova('welcome');
    expect(consegnate, 'Giulia ha ricevuto due volte la stessa email').toHaveLength(1);
    expect(secondo.sent).toBe(1);
    expect(scritturaDi('q1').some((s) => typeof s.valori.sent_at === 'string')).toBe(true);
  });

  it('anche una promozione (link di disiscrizione nuovo a ogni giro) non esce due volte', async () => {
    await timeoutPoiRiprova('first_order_promo');
    expect(consegnate, 'la promozione è uscita due volte').toHaveLength(1);
  });

  it('la chiave è la stessa a ogni tentativo della riga e la chiave d\'accesso resta', async () => {
    await timeoutPoiRiprova('welcome');
    expect(consegnate[0].chiave).toBe('email-queue/q1');
    expect(accessi.every((a) => a === 'Bearer re_prova'), 'la richiesta ha perso la chiave d\'accesso').toBe(true);
  });

  it('controprova: due righe diverse sono due email, tutte e due spedite', async () => {
    const scade_at = new Date(Date.now() + 2 * GIORNO).toISOString();
    coda = [
      { id: 'q1', user_id: 'u1', template: 'welcome', attempts: 0, scade_at },
      { id: 'q2', user_id: 'u1', template: 'welcome', attempts: 0, scade_at },
    ];
    const giro = await giroDellaPosta();
    expect(giro.sent).toBe(2);
    expect(consegnate).toHaveLength(2);
  });
});
