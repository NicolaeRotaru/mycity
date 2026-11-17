/**
 * R02-004 — In produzione, con la chiave segreta anti-robot presente e la pubblica assente, la
 * pagina Contatti non disegna il riquadro, nessun gettone arriva, e /api/contact rispondeva
 * «Verifica anti-bot fallita. Riprova.»: riprovare non serve (la configurazione è a metà, non è un
 * robot) e non diceva dove scrivere. Ora in quel caso la risposta dice dove scrivere, con la
 * casella che la pagina Contatti già mostra, e la porta nei dettagli (`recapito`) che la pagina
 * mette sotto il modulo. Il caso del robot vero (chiave pubblica presente, gettone assente o
 * falso) non cambia.
 *
 * Variabili d'ambiente finte (vi.stubEnv), database e posta finti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const insertMock = vi.fn(async (_r: Record<string, unknown>) => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: () => ({ insert: insertMock }) }),
  getCurrentUser: async () => null,
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: () => undefined }));

import { POST } from '@/app/api/contact/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { indirizzoContatto } from '@/lib/contatti-pubblici';
import { recapitoDallaRisposta } from '@/lib/legal/titolare';

const corpo = {
  name: 'Mario Rossi',
  email: 'mario@example.com',
  subject: 'Domanda',
  message: 'Questo è un messaggio di prova abbastanza lungo.',
};
let n = 0;
const richiesta = (extra: Record<string, unknown> = {}) =>
  new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `7.0.0.${++n}` },
    body: JSON.stringify({ ...corpo, ...extra }),
  });

beforeEach(() => {
  __resetRateLimitBuckets();
  insertMock.mockClear();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'segreta-finta');
  vi.stubEnv('NEXT_PUBLIC_CONTATTI_DOMINIO', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('R02-004 · anti-robot a metà: il modulo contatti dice dove scrivere', () => {
  it('segreta presente, pubblica assente: niente «riprova», c\'è la casella a cui scrivere', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const res = await POST(richiesta());
    expect(res.ok).toBe(false);
    const json = (await res.json()) as { error: { message: string } };
    const casella = indirizzoContatto('info');
    expect(json.error.message, 'deve dire dove scrivere').toContain(casella);
    expect(json.error.message).not.toMatch(/riprova/i);
    // La pagina Contatti mette sotto il modulo il recapito dei dettagli: dev'essere quella casella.
    expect(recapitoDallaRisposta(json)).toEqual({ href: `mailto:${casella}`, testo: casella });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('il robot vero non cambia: chiave pubblica presente e nessun gettone → «Verifica anti-bot fallita»', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    const res = await POST(richiesta());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('Verifica anti-bot fallita. Riprova.');
    expect(recapitoDallaRisposta(json)).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('il robot vero non cambia: gettone falso respinto da Cloudflare → «Verifica anti-bot fallita»', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    const res = await POST(richiesta({ captchaToken: 'falso' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('Verifica anti-bot fallita. Riprova.');
    expect(insertMock).not.toHaveBeenCalled();
  });
});
