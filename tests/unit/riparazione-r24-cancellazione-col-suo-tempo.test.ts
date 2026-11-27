/**
 * R24-006 — IL TETTO DEL CICLO DELLE CANCELLAZIONI NON ERA RIGIDO, E UN ACCOUNT NON AVEVA UN TEMPO SUO.
 *
 * Il tetto (150 secondi dall'inizio del giro) si guardava solo prima di prendere un account: quello
 * preso poteva durare quanto voleva. Un account preso a ridosso del tetto che durava altri 150
 * secondi portava la notte oltre i 300 secondi della piattaforma prima della risposta (e prima di
 * sveglia ed email). Adesso l'account preso ha come scadenza il tetto del ciclo: finito il tempo non
 * lo si aspetta più, conta come rimandato alla notte dopo, e la cancellazione con la stessa scadenza
 * non comincia altri passi (soprattutto non cancella l'account alle spalle del giro).
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
import { cancellaAccount } from '@/lib/account/cancellazione';

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

describe('R24-006 · il tetto del ciclo è rigido e l’account preso ha un tempo suo', () => {
  it('il primo account si pianta per 400 secondi: la notte non lo aspetta oltre il tetto e risponde entro i 300 secondi', async () => {
    const scadute = [1, 2].map((n) => ({ user_id: utente(n), deleted_at: giorniFa(8 + n) }));
    mondo.durate = { [utente(2)]: 400_000 }; // il più vecchio, preso per primo
    const giro = laNotte(scadute);

    const { r, dopoMs } = await unGiroCronometrato();
    const corpo = (await r.json()) as { processed?: number; rimandateAlGiroDopo?: number };

    expect(dopoMs, 'la notte ha aspettato l’account oltre il limite della piattaforma').toBeLessThan(LIMITE_PIATTAFORMA_MS);
    expect(dopoMs, 'il ciclo delle cancellazioni è andato oltre il suo tetto').toBeLessThanOrEqual(TETTO_DEL_CICLO_MS);
    expect(corpo.processed).toBe(0);
    expect(corpo.rimandateAlGiroDopo, 'l’account lasciato a metà e quello dopo restano alla notte dopo').toBe(2);
    expect(giro.notifiche().some((n) => String(n.title).startsWith('Cancellazioni rimandate'))).toBe(true);
  });

  it('un account preso poco prima del tetto e lento: la notte non sfora, l’account torna alla notte dopo', async () => {
    const scadute = [1, 2, 3].map((n) => ({ user_id: utente(n), deleted_at: giorniFa(20 - n) }));
    mondo.durate = { [utente(1)]: 149_000, [utente(2)]: 400_000 };
    laNotte(scadute);

    const { r, dopoMs } = await unGiroCronometrato();
    const corpo = (await r.json()) as { processed?: number; rimandateAlGiroDopo?: number };

    expect(mondo.inizi.map((i) => i.userId)).toEqual([utente(1), utente(2)]);
    expect(mondo.inizi[1].quando - ADESSO).toBeLessThan(TETTO_DEL_CICLO_MS);
    expect(dopoMs, 'l’account preso a ridosso del tetto ha portato la notte oltre i 300 secondi').toBeLessThan(LIMITE_PIATTAFORMA_MS);
    expect(dopoMs).toBeLessThanOrEqual(TETTO_DEL_CICLO_MS);
    expect(corpo.processed).toBe(1);
    expect(corpo.rimandateAlGiroDopo).toBe(2);
  });

  it('la cancellazione vera, con la scadenza passata durante un passo, non cancella l’account alle spalle del giro', async () => {
    mondo.finte = false;
    const id = utente(9);
    const giro = laNotte([]);
    const deleteUser = vi.fn(async () => ({ error: null }));
    const admin = giro.admin as unknown as {
      auth: { admin: { deleteUser: typeof deleteUser } };
      storage: { from: (s: string) => { list: (p: string, o?: unknown) => Promise<unknown> } };
    };
    admin.auth.admin.deleteUser = deleteUser;
    // Lo storage è lento: elencare i file della persona porta il tempo oltre la scadenza.
    const daPrima = admin.storage.from;
    admin.storage.from = (secchio: string) => {
      const vero = daPrima(secchio);
      return {
        ...vero,
        list: async (p: string, o?: unknown) => {
          vi.setSystemTime(Date.now() + 30_000);
          return vero.list(p, o);
        },
      };
    };

    const esito = await cancellaAccount(admin as never, id, { scadenza: ADESSO + 10_000 });

    expect(deleteUser, 'la cancellazione ha chiuso l’account dopo la scadenza, quando il giro non la aspettava più').not.toHaveBeenCalled();
    expect(esito.ok).toBe(false);
  });

  it('senza scadenza (l’amministratore) la cancellazione va fino in fondo come prima', async () => {
    mondo.finte = false;
    const giro = laNotte([]);
    const deleteUser = vi.fn(async () => ({ error: null }));
    (giro.admin as unknown as { auth: { admin: { deleteUser: typeof deleteUser } } }).auth.admin.deleteUser = deleteUser;

    const esito = await cancellaAccount(giro.admin as never, utente(8));

    expect(esito.ok).toBe(true);
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });
});
