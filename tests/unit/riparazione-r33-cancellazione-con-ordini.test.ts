/**
 * R33-014 — Il giro notturno prendeva in carico la cancellazione di un negozio che aveva
 * ancora un ordine aperto e soldi da incassare.
 *
 * Dalla migrazione 572 `process_expired_deletions` lascia fuori quel negozio (la prova SQL
 * tests/sql/rls/riparazione-r33-cancellazione-con-ordini.test.sql). Qui la rotta: la
 * richiesta scaduta che la funzione non restituisce non si cancella, resta in piedi per la
 * notte dopo, e gli amministratori ricevono l'avviso, una volta sola.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, cancellati: [] as string[] }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/cron/process-deletions/route';

const NEGOZIO = '00000000-0000-4000-8000-0000000000b3';
const ADESSO = new Date('2026-11-17T03:00:00+01:00').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

function laNotte() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: NEGOZIO, role: 'seller', deletion_requested_at: giorniFa(8) },
      ],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    // La 572: il negozio ha un ordine aperto, la funzione non lo restituisce.
    rpc: { process_expired_deletions: { data: [], error: null } },
  });
  mondo.admin = {
    ...giro.admin,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'negozio@example.it' } }, error: null }),
        deleteUser: async (id: string) => { mondo.cancellati.push(id); return { error: null }; },
      },
    },
  };
  return giro;
}

const unGiro = () =>
  POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );

const segretoSalvato = process.env.CRON_SECRET;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.cancellati = [];
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
  process.env.CRON_SECRET = segretoSalvato;
});

const avvisiDelRinvio = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /Cancellazione rinviata/.test(String(n.title)));

describe('R33-014 — la cancellazione del negozio con ordini aperti si rimanda e si segnala', () => {
  it('il negozio non si cancella, la richiesta resta, e gli amministratori lo sanno', async () => {
    const giro = laNotte();
    const r = await unGiro();
    const corpo = (await r.json()) as { rinviatePerOrdiniAperti?: number };

    expect(mondo.cancellati).toEqual([]);
    expect(giro.righe('profiles').find((p) => p.id === NEGOZIO)?.deletion_requested_at).toBe(giorniFa(8));
    expect(corpo.rinviatePerOrdiniAperti, 'la notte non dice quante cancellazioni ha rimandato').toBe(1);
    const avvisi = avvisiDelRinvio(giro);
    expect(avvisi, 'nessuno sa che la cancellazione del negozio è ferma').toHaveLength(1);
    expect(String(avvisi[0]!.body)).toMatch(/ordine aperto o soldi da incassare/);
  });

  it('la notte dopo il negozio è ancora fermo: l’avviso non si ripete', async () => {
    const giro = laNotte();
    await unGiro();
    await unGiro();
    expect(avvisiDelRinvio(giro)).toHaveLength(1);
  });

  it('chi la funzione restituisce non è «rinviato»', async () => {
    const giro = laNotte();
    mondo.admin = {
      ...(mondo.admin as object),
      rpc: async () => ({ data: [{ user_id: NEGOZIO, deleted_at: giorniFa(8) }], error: null }),
    };
    const corpo = (await (await unGiro()).json()) as { rinviatePerOrdiniAperti?: number };
    expect(corpo.rinviatePerOrdiniAperti).toBe(0);
    expect(avvisiDelRinvio(giro)).toHaveLength(0);
  });
});
