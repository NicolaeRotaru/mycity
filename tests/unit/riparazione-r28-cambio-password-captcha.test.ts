/**
 * 26/11/2026 (R28-012) — COL CAPTCHA ACCESO SU SUPABASE IL CAMBIO PASSWORD NON DICE
 * «PASSWORD NON CORRETTA» A CHI LA SAPEVA GIUSTA.
 *
 * La rotta prova la password attuale con un accesso vero (signInWithPassword).
 * Col CAPTCHA acceso su Supabase, senza gettone (o con uno scaduto) Supabase
 * risponde `captcha_failed` senza nemmeno guardare la password, e la rotta lo
 * leggeva come «Password attuale non corretta». Supabase finto che risponde come
 * quello vero (AuthApiError 400, codice captcha_failed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';

const stato = vi.hoisted(() => ({
  captchaAcceso: true,
  prove: [] as Array<{ email: string; options?: { captchaToken?: string } }>,
  cambi: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      handler({ user: { id: 'u-12', email: 'luca@esempio.it', app_metadata: { providers: ['email'] } }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      signInWithPassword: async (dati: { email: string; password: string; options?: { captchaToken?: string } }) => {
        stato.prove.push({ email: dati.email, options: dati.options });
        if (stato.captchaAcceso && !dati.options?.captchaToken) {
          return {
            data: { user: null, session: null },
            error: new AuthApiError('captcha protection: request disallowed (no captcha response)', 400, 'captcha_failed'),
          };
        }
        if (dati.password !== 'quella-giusta-1') {
          return {
            data: { user: null, session: null },
            error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
          };
        }
        return { data: { user: { id: 'u-12' }, session: {} }, error: null };
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
          return { data: { user: { id: 'u-12' } }, error: null };
        },
      },
    },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

async function cambia(corpo: Record<string, unknown>): Promise<{ status: number; messaggio: string }> {
  const res = (await POST(
    new Request('https://mycity.test/api/account/cambia-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }) as never,
  )) as Response;
  const j = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: j.error?.message ?? '' };
}

beforeEach(() => {
  stato.captchaAcceso = true;
  stato.prove.length = 0;
  stato.cambi = 0;
});

describe('R28-012 · il gettone mancante non è una password sbagliata', () => {
  it('IL CASO CHE ROMPEVA — captcha_failed con la password giusta: niente «non corretta», si dice il controllo anti-robot', async () => {
    const r = await cambia({ passwordAttuale: 'quella-giusta-1', nuovaPassword: 'nuova-password-1' });
    expect(stato.prove, 'la rotta non ha provato la password: la prova non guarda niente').toHaveLength(1);
    expect(r.messaggio).not.toMatch(/non corretta/i);
    expect(r.messaggio).toMatch(/anti-robot/);
    expect(r.messaggio).toMatch(/la password non c'entra/);
    expect(r.status).toBe(400);
    expect(stato.cambi).toBe(0);
  });

  it('il gettone che la pagina manda arriva a Supabase, e il cambio riesce', async () => {
    const r = await cambia({ passwordAttuale: 'quella-giusta-1', nuovaPassword: 'nuova-password-1', captchaToken: 'gettone-12' });
    expect(stato.prove[0].options?.captchaToken).toBe('gettone-12');
    expect(r.status).toBe(200);
    expect(stato.cambi).toBe(1);
  });

  it('la password davvero sbagliata resta «Password attuale non corretta»', async () => {
    const r = await cambia({ passwordAttuale: 'sbagliata-1', nuovaPassword: 'nuova-password-1', captchaToken: 'gettone-12' });
    expect(r).toEqual({ status: 401, messaggio: 'Password attuale non corretta' });
    expect(stato.cambi).toBe(0);
  });
});
