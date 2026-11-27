/**
 * R24-007 — UN ACCOUNT PRESO POCO PRIMA DEL TETTO DEL CICLO NON AVEVA UN TEMPO SUO.
 *
 * Il tetto del ciclo (150 secondi) si guardava solo prima di prendere un account: uno preso a
 * 140 secondi poteva durare quanto voleva, e la notte rispondeva solo quando lui finiva. Adesso
 * l'account preso ha come scadenza il tetto del ciclo: a 150 secondi non lo si aspetta più e torna
 * alla notte dopo. La correzione è la stessa della voce sul tetto rigido (commit comune, insieme_a):
 * questa prova guarda solo il caso dell'account preso a ridosso del tetto.
 *
 * Orologio finto (anche i timer); Supabase finto, in memoria: nessun database vero, nessuno Stripe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({
  admin: null as unknown,
  durate: {} as Record<string, number>,
  inizi: [] as Array<{ userId: string; quando: number }>,
  finte: true,
}));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => false,
  getStripe: () => {
    throw new Error('Stripe vero: mai nelle prove');
  },
}));
vi.mock('@/lib/account/cancellazione', async (originale) => {
  const vero = await originale<typeof import('@/lib/account/cancellazione')>();
  return {
    ...vero,
    // Nella prova della rotta la cancellazione è finta e dura quanto dice `durate` (sul timer finto).
    cancellaAccount: vi.fn((admin: never, userId: string, opzioni?: { scadenza?: number }) => {
      if (!mondo.finte) return vero.cancellaAccount(admin, userId, opzioni);
      mondo.inizi.push({ userId, quando: Date.now() });
      return new Promise((risolvi) =>
        setTimeout(() => risolvi({ ok: true, fileRimossi: 0, erroriFile: [] }), mondo.durate[userId] ?? 1_000),
      );
    }),
  };
});

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-26T04:00:00+01:00').getTime();
const LIMITE_PIATTAFORMA_MS = 300_000;
const TETTO_DEL_CICLO_MS = 150_000;
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const utente = (n: number) => `00000000-0000-4000-8000-00000000003${n}`;

function laNotte(scadute: Array<{ user_id: string; deleted_at: string }>) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...scadute.map((r) => ({ id: r.user_id, role: 'buyer', deletion_requested_at: r.deleted_at })),
      ],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: scadute, error: null } },
  });
  mondo.admin = giro.admin;
  return giro;
}

/** Fa girare la notte sul tempo finto e dice a che ora (finta) è arrivata la risposta. */
async function unGiroCronometrato() {
  const finita = POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  ).then((r) => ({ r, dopoMs: Date.now() - ADESSO }));
  await vi.advanceTimersByTimeAsync(1_000_000);
  return finita;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(ADESSO);
  mondo.durate = {};
  mondo.inizi = [];
  mondo.finte = true;
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R24-007 · l’account preso poco prima del tetto del ciclo ha un tempo suo', () => {
  it('preso a 140 secondi e lento 100 secondi: la notte risponde al tetto, non a 240 secondi', async () => {
    const scadute = [1, 2].map((n) => ({ user_id: utente(n), deleted_at: giorniFa(20 - n) }));
    mondo.durate = { [utente(1)]: 140_000, [utente(2)]: 100_000 };
    laNotte(scadute);

    const { r, dopoMs } = await unGiroCronometrato();
    const corpo = (await r.json()) as { processed?: number; rimandateAlGiroDopo?: number };

    expect(mondo.inizi.map((i) => i.userId)).toEqual([utente(1), utente(2)]);
    expect(mondo.inizi[1].quando - ADESSO, 'il secondo account non è stato preso a ridosso del tetto').toBe(140_000);
    expect(dopoMs, 'la notte ha aspettato l’account preso a ridosso del tetto oltre il tetto del ciclo').toBeLessThanOrEqual(TETTO_DEL_CICLO_MS);
    expect(dopoMs).toBeLessThan(LIMITE_PIATTAFORMA_MS);
    expect(corpo.processed).toBe(1);
    expect(corpo.rimandateAlGiroDopo, 'l’account lasciato a metà torna alla notte dopo').toBe(1);
  });
});
