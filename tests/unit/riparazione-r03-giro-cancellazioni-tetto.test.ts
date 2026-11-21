/**
 * R03-005 — IL GIRO NOTTURNO DELLE CANCELLAZIONI NON AVEVA UN TETTO DI TEMPO SUL CICLO DEGLI ACCOUNT SCADUTI.
 *
 * La piattaforma dà a un giro al massimo 300 secondi dall'inizio. Il ciclo `for (const riga of
 * scadute)` prendeva in carico un account dopo l'altro finché c'erano: con una notte lunga si
 * mangiava tutto il tempo. Adesso, passato il tetto dall'inizio del giro, non si prende in carico
 * un account nuovo: chi resta aspetta la notte dopo, con la richiesta ancora lì.
 *
 * L'orologio è finto: ogni cancellazione «dura» un minuto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, inizi: [] as number[], durata: 60_000 }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    mondo.inizi.push(Date.now());
    vi.setSystemTime(Date.now() + mondo.durata);
    return { ok: true, fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const utente = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const SCADUTE = [1, 2, 3, 4, 5, 6].map((n) => ({ user_id: utente(n), deleted_at: giorniFa(8) }));

function laNotte() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...SCADUTE.map((r) => ({ id: r.user_id, role: 'buyer', deletion_requested_at: r.deleted_at })),
      ],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: SCADUTE, error: null } },
  });
  mondo.admin = giro.admin;
  return giro;
}

const unGiro = () =>
  POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.inizi = [];
  mondo.durata = 60_000;
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-005 · il ciclo degli account scaduti ha un tetto di tempo', () => {
  it('sei account da un minuto l’uno: il ciclo si ferma prima della fine dei 300 secondi e lascia gli altri alla notte dopo', async () => {
    laNotte();
    const r = await unGiro();
    const corpo = (await r.json()) as { processed?: number; total?: number };

    expect(mondo.inizi.length, 'il ciclo ha preso in carico tutti gli account, senza tetto di tempo').toBeLessThan(SCADUTE.length);
    expect(mondo.inizi.length, 'il tetto non deve fermare il ciclo prima del primo account').toBeGreaterThan(0);
    // Ogni presa in carico parte entro la metà del tempo del giro: l'altra metà resta a sveglia, avvisi ed email.
    for (const t of mondo.inizi) expect(t - ADESSO).toBeLessThan(150_000);
    expect(corpo.processed).toBe(mondo.inizi.length);
    expect(corpo.total).toBe(SCADUTE.length);
  });

  it('una notte corta non cambia: tutti gli account presi in carico', async () => {
    mondo.durata = 1_000;
    laNotte();
    const r = await unGiro();
    const corpo = (await r.json()) as { processed?: number };
    expect(mondo.inizi).toHaveLength(SCADUTE.length);
    expect(corpo.processed).toBe(SCADUTE.length);
  });
});
