import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R02-010 — CHI SEGNALA LASCIANDO L'EMAIL RICEVE LA CONFERMA CHE LA SEGNALAZIONE È ARRIVATA.
 *
 * Il regolamento sui servizi digitali (art. 16.4) chiede una conferma di ricezione al recapito
 * lasciato. Prima la rotta avvisava solo gli amministratori e rispondeva 201: nessuna email.
 * Qui l'invio è finto (`sendEmail` sostituito): mai email vere.
 */

const posta = vi.hoisted(() => ({ inviate: [] as Array<Record<string, unknown>>, risposta: { ok: true, id: 'em-1' } as Record<string, unknown> }));
const tetto = vi.hoisted(() => ({ chiavi: [] as string[], conte: new Map<string, number>() }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (input: Record<string, unknown>) => { posta.inviate.push(input); return posta.risposta; },
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '1.2.3.4',
  rateLimitAsync: async ({ key, max }: { key: string; max: number }) => {
    tetto.chiavi.push(key);
    const n = (tetto.conte.get(key) ?? 0) + 1;
    tetto.conte.set(key, n);
    return { allowed: n <= max, retryAfterSec: 0 };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'segnalazioni') {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: '5e9a1a2b-0000-4000-8000-000000000042', created_at: '2026-11-26T10:15:00Z' }, error: null }) }),
          }),
        };
      }
      if (tabella === 'profiles') return { select: () => ({ eq: async () => ({ data: [{ id: 'admin-1' }], error: null }) }) };
      if (tabella === 'notifications') return { insert: async () => ({ error: null }) };
      return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { id }, error: null }) }) }) };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

const ID_PRODOTTO = '11111111-1111-4111-8111-111111111111';
const chiama = (extra: Record<string, unknown> = {}) =>
  POST(new Request('https://mycity.test/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'prodotto', oggettoId: ID_PRODOTTO, motivo: 'contraffatto', dettaglio: 'Compra da http://truffa.example', ...extra }),
  }) as never);

beforeEach(() => {
  posta.inviate = [];
  posta.risposta = { ok: true, id: 'em-1' };
  tetto.chiavi = [];
  tetto.conte = new Map();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T10:15:30Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('R02-010 — la ricevuta della segnalazione', () => {
  it('IL CASO CHE ROMPEVA — con l\'email lasciata parte una ricevuta con numero, oggetto, motivo e data', async () => {
    const r = await chiama({ emailContatto: 'titolare@marchio.example' });
    expect(r.status).toBe(201);
    expect(posta.inviate, 'nessuna conferma di ricezione a chi ha segnalato').toHaveLength(1);
    const email = posta.inviate[0];
    expect(email.to).toBe('titolare@marchio.example');
    expect(email.tipo).toBe('transazionale');
    const testo = String(email.text);
    expect(String(email.subject)).toContain('5e9a1a2b-0000-4000-8000-000000000042');
    expect(testo).toContain('Numero: 5e9a1a2b-0000-4000-8000-000000000042');
    expect(testo).toContain('un prodotto');
    expect(testo).toContain('prodotto contraffatto');
    expect(testo).toContain('26/11/2026');
    // Il testo libero di chi segnala non viaggia verso un indirizzo che potrebbe essere di un altro.
    expect(testo).not.toContain('truffa.example');
    expect(String(email.html)).not.toContain('truffa.example');
    expect(await r.json()).toMatchObject({ ok: true, conferma: 'inviata' });
  });

  it('senza email non parte niente', async () => {
    const r = await chiama();
    expect(r.status).toBe(201);
    expect(posta.inviate).toHaveLength(0);
    expect(await r.json()).toMatchObject({ conferma: 'nessun_recapito' });
  });

  it('una ricevuta non partita si dice nella risposta, e la segnalazione resta registrata', async () => {
    posta.risposta = { ok: false, error: 'posta giù' };
    const r = await chiama({ emailContatto: 'titolare@marchio.example' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, conferma: 'fallita' });
  });

  it('lo stesso indirizzo scritto in modi diversi conta insieme nel tetto delle ricevute', async () => {
    for (const e of ['Mario.Rossi@gmail.com', 'mariorossi+a@gmail.com', 'MARIO.ROSSI+b@googlemail.com', 'm.a.r.i.o.rossi@gmail.com']) {
      await chiama({ emailContatto: e });
    }
    expect(posta.inviate, 'il tetto per indirizzo non conta le scritture diverse insieme').toHaveLength(3);
    const chiaviRicevuta = new Set(tetto.chiavi.filter((k) => k.startsWith('segnalazioni-ricevuta:')));
    expect(chiaviRicevuta.size).toBe(1);
    // L'indirizzo non finisce in chiaro nella chiave del tetto.
    expect([...chiaviRicevuta][0]).not.toContain('gmail');
  });
});
