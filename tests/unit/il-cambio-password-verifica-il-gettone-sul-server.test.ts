/**
 * Il cambio password (/api/account/cambia-password) verifica il gettone anti-robot come l'accesso e
 * la registrazione (/api/auth/signin, /api/auth/signup):
 *  - con `CAPTCHA_SU_SUPABASE_ACCESO` spenta (la configurazione di partenza) lo verifica il server
 *    con siteverify, PRIMA di provare la password attuale: un gettone rifiutato o assente ferma la
 *    richiesta con un 400 e Supabase non vede nessun tentativo di accesso;
 *  - con l'interruttore acceso il server non chiama siteverify (il gettone vale una volta sola) e
 *    lo passa a Supabase insieme alla prova della password.
 *
 * Cloudflare è finto ma si comporta come quello vero: un gettone emesso vale una volta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({
  prove: [] as Array<{ email: string; password: string; captchaToken?: string }>,
  cambi: 0,
}));

const cloudflare = vi.hoisted(() => {
  const emessi = new Set<string>();
  const usi = new Map<string, number>();
  return {
    chiamate: [] as Array<{ response: string | null; remoteip: string | null }>,
    emetti(gettone: string) {
      emessi.add(gettone);
    },
    azzera() {
      emessi.clear();
      usi.clear();
      this.chiamate.length = 0;
    },
    /** Come siteverify: vero solo al primo uso di un gettone emesso. */
    verifica(gettone: string | null): { success: boolean } {
      if (!gettone) return { success: false };
      const n = (usi.get(gettone) ?? 0) + 1;
      usi.set(gettone, n);
      return { success: emessi.has(gettone) && n === 1 };
    },
  };
});

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      handler({ user: { id: 'u-31', email: 'giulia@esempio.it', app_metadata: { providers: ['email'] } }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      signInWithPassword: async (dati: { email: string; password: string; options?: { captchaToken?: string } }) => {
        stato.prove.push({ email: dati.email, password: dati.password, captchaToken: dati.options?.captchaToken });
        return dati.password === 'quella-giusta-1'
          ? { data: { user: { id: 'u-31' }, session: {} }, error: null }
          : { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
      },
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: {
      admin: {
        updateUserById: async () => {
          stato.cambi += 1;
          return { data: { user: { id: 'u-31' } }, error: null };
        },
      },
    },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const fetchFinto = (async (input: unknown, init?: { body?: unknown }) => {
  const url = String(input);
  if (url !== SITEVERIFY) throw new Error(`rete non prevista in questa prova: ${url}`);
  const corpo = new URLSearchParams(String(init?.body ?? ''));
  cloudflare.chiamate.push({ response: corpo.get('response'), remoteip: corpo.get('remoteip') });
  return new Response(JSON.stringify(cloudflare.verifica(corpo.get('response'))), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

async function cambia(corpo: Record<string, unknown>): Promise<{ status: number; messaggio: string }> {
  const res = (await POST(
    new Request('https://mycity.test/api/account/cambia-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.7' },
      body: JSON.stringify(corpo),
    }) as never,
  )) as Response;
  const j = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: j.error?.message ?? '' };
}

const GIUSTA = { passwordAttuale: 'quella-giusta-1', nuovaPassword: 'nuova-password-1' };

beforeEach(() => {
  stato.prove.length = 0;
  stato.cambi = 0;
  cloudflare.azzera();
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'segreto-finto');
  vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', '');
  vi.stubGlobal('fetch', fetchFinto);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('interruttore spento: il gettone lo verifica il server, prima della password', () => {
  it('un gettone rifiutato da Cloudflare: 400, e la password attuale non si prova', async () => {
    const r = await cambia({ ...GIUSTA, captchaToken: 'gettone-inventato' });

    expect(cloudflare.chiamate, 'il server non ha chiesto a Cloudflare se il gettone è buono').toEqual([
      { response: 'gettone-inventato', remoteip: '10.9.0.7' },
    ]);
    expect(r.status).toBe(400);
    expect(r.messaggio).toMatch(/anti-robot/);
    expect(r.messaggio).toMatch(/la password non c'entra/);
    expect(stato.prove, 'col gettone rifiutato la password attuale è stata provata lo stesso').toHaveLength(0);
    expect(stato.cambi).toBe(0);
  });

  it('senza gettone: 400, e la password attuale non si prova', async () => {
    const r = await cambia(GIUSTA);

    expect(r.status).toBe(400);
    expect(r.messaggio).toMatch(/anti-robot/);
    expect(stato.prove, 'senza gettone la password attuale è stata provata lo stesso').toHaveLength(0);
    expect(stato.cambi).toBe(0);
  });

  it('un gettone già speso non passa una seconda volta', async () => {
    cloudflare.emetti('gettone-12');
    expect((await cambia({ ...GIUSTA, captchaToken: 'gettone-12' })).status).toBe(200);
    const seconda = await cambia({ passwordAttuale: 'nuova-password-1', nuovaPassword: 'altra-password-1', captchaToken: 'gettone-12' });

    expect(seconda.status).toBe(400);
    expect(stato.prove).toHaveLength(1);
    expect(stato.cambi).toBe(1);
  });

  it('un gettone buono: siteverify una volta, poi la prova della password e il cambio', async () => {
    cloudflare.emetti('gettone-buono');
    const r = await cambia({ ...GIUSTA, captchaToken: 'gettone-buono' });

    expect(cloudflare.chiamate).toHaveLength(1);
    expect(r.status).toBe(200);
    expect(stato.prove).toHaveLength(1);
    expect(stato.cambi).toBe(1);
  });

  it('la password davvero sbagliata, col gettone buono, resta «Password attuale non corretta»', async () => {
    cloudflare.emetti('gettone-buono');
    const r = await cambia({ passwordAttuale: 'sbagliata-1', nuovaPassword: 'nuova-password-1', captchaToken: 'gettone-buono' });

    expect(r).toEqual({ status: 401, messaggio: 'Password attuale non corretta' });
    expect(stato.cambi).toBe(0);
  });

  it('la stessa password di prima si dice senza chiedere niente a Cloudflare', async () => {
    const r = await cambia({ passwordAttuale: 'quella-giusta-1', nuovaPassword: 'quella-giusta-1', captchaToken: 'gettone-x' });

    expect(r.status).toBe(400);
    expect(cloudflare.chiamate).toHaveLength(0);
    expect(stato.prove).toHaveLength(0);
  });

  it('senza chiave segreta fuori dalla produzione la verifica si salta, come per accesso e registrazione', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const r = await cambia(GIUSTA);

    expect(cloudflare.chiamate).toHaveLength(0);
    expect(r.status).toBe(200);
    expect(stato.prove).toHaveLength(1);
  });
});

describe('interruttore acceso: il gettone lo verifica Supabase, il server non lo spende', () => {
  it.each(['1', 'true'])('CAPTCHA_SU_SUPABASE_ACCESO=%s: niente siteverify, il gettone arriva a Supabase', async (valore) => {
    vi.stubEnv('CAPTCHA_SU_SUPABASE_ACCESO', valore);
    cloudflare.emetti('gettone-per-supabase');
    const r = await cambia({ ...GIUSTA, captchaToken: 'gettone-per-supabase' });

    expect(cloudflare.chiamate, 'il server ha speso il gettone che serviva a Supabase').toHaveLength(0);
    expect(stato.prove).toHaveLength(1);
    expect(stato.prove[0].captchaToken).toBe('gettone-per-supabase');
    expect(r.status).toBe(200);
    expect(stato.cambi).toBe(1);
  });
});
