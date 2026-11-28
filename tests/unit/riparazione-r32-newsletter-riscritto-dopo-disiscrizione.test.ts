import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R32-012 — CHI SI DISISCRIVEVA DALLA NEWSLETTER E POI SI ISCRIVEVA DI NUOVO RESTAVA SEGNATO COME
 * DISISCRITTO ANCHE DOPO AVER CONFERMATO.
 *
 * La disiscrizione (migrazione 118) scrive `active = false` e `unsubscribed_at`. La nuova
 * iscrizione riscrive la riga senza toccare `unsubscribed_at` — giusto: finché la persona non
 * conferma dalla sua casella, la disiscrizione vale. Ma la conferma scriveva solo `active`,
 * `confirmed_at` e `confirm_token`: la riga restava «attiva» e «disiscritta» insieme.
 *
 * La prova fa il giro vero sulle due rotte, con una tabella finta che tiene la riga.
 */

type Riga = Record<string, unknown>;
const tabella: Riga[] = [];

/** Una tabella finta con i soli pezzi di PostgREST che le due rotte usano. */
function query() {
  const filtri: Array<[string, unknown]> = [];
  let cambio: Riga | null = null;
  let nuova: Riga | null = null;
  const trova = () => tabella.filter((r) => filtri.every(([k, v]) => r[k] === v));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filtri.push([k, v]); return q; },
    update: (c: Riga) => { cambio = c; return q; },
    insert: async (r: Riga) => { nuova = { id: tabella.length + 1, ...r }; tabella.push(nuova); return { error: null }; },
    maybeSingle: async () => {
      const righe = trova();
      if (cambio) for (const r of righe) Object.assign(r, cambio);
      return { data: righe[0] ? { ...righe[0] } : null, error: null };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      // `await admin.from(..).update(..).eq(..)` senza maybeSingle: si applica e basta.
      if (cambio) for (const r of trova()) Object.assign(r, cambio);
      return Promise.resolve({ error: null }).then(ok, ko);
    },
  };
  return q;
}

const email: Array<{ to: string; html: string }> = [];

vi.mock('@/lib/funzioni-al-lancio', async (o) => ({ ...((await o()) as Record<string, unknown>), NEWSLETTER_ACCESA: true }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: () => query() }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async (a: { to: string; html: string }) => { email.push(a); return { ok: true }; } }));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));

import { POST as iscrivi } from '@/app/api/newsletter/route';
import { GET as conferma } from '@/app/api/newsletter/confirm/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const ADESSO = new Date('2026-11-17T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  tabella.length = 0;
  email.length = 0;
  __resetRateLimitBuckets();
  // Mario si era iscritto a marzo, e a settembre ha cliccato «Cancellami» (migrazione 118).
  tabella.push({
    id: 1,
    email: 'mario@example.com',
    active: false,
    confirmed_at: '2026-03-01T09:00:00Z',
    unsubscribed_at: '2026-09-10T18:00:00Z',
    confirm_token: null,
    created_at: '2026-03-01T08:55:00Z',
  });
});
afterEach(() => vi.useRealTimers());

async function chiediIscrizione() {
  const res = await iscrivi(new Request('https://mycity.test/api/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '93.40.30.7' },
    body: JSON.stringify({ email: 'Mario@Example.com' }),
  }));
  expect(res.status).toBe(200);
}

function gettoneDallEmail(): string {
  const link = /href="([^"]+)"/.exec(email.at(-1)?.html ?? '')?.[1] ?? '';
  return new URL(link).searchParams.get('token') ?? '';
}

describe('R32-012 · chi torna e conferma non resta disiscritto', () => {
  it('finché non conferma, la disiscrizione vale ancora', async () => {
    await chiediIscrizione();
    expect(email, 'al disiscritto che torna deve partire una conferma nuova').toHaveLength(1);
    expect(tabella[0].active).toBe(false);
    expect(tabella[0].unsubscribed_at, 'la sola richiesta, senza conferma, non deve cancellare la disiscrizione').toBe('2026-09-10T18:00:00Z');
  });

  it('IL CASO CHE ROMPEVA — dopo la conferma la riga è attiva e non porta più la data della disiscrizione', async () => {
    await chiediIscrizione();
    const token = gettoneDallEmail();
    expect(token, 'nell\'email non c\'è il link di conferma').not.toBe('');

    const res = await conferma(new Request(`https://mycity.test/api/newsletter/confirm?token=${encodeURIComponent(token)}`, {
      headers: { 'x-forwarded-for': '93.40.30.7' },
    }));
    // R04-007 (onda 2): la conferma porta alla sua pagina, che dice l'esito (prima: la home con un parametro che nessuno leggeva).
    expect(res.headers.get('location')).toBe('https://mycity.test/newsletter?esito=confermata');

    expect(tabella[0].active).toBe(true);
    expect(tabella[0].confirmed_at).toBe(ADESSO.toISOString());
    expect(tabella[0].confirm_token).toBeNull();
    expect(tabella[0].unsubscribed_at, 'ha confermato, e la riga lo dice ancora disiscritto').toBeNull();
  });
});
