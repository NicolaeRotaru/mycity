import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * R02-007 — IL GIRO A MANO CONTA LE FOTO DI CONSEGNA ORFANE CHE LA NOTTE TOGLIERÀ.
 *
 * Il giro a mano (`?a_mano=1`) e il conto della notte prima di accendere CANCELLAZIONI_A_ORARIO
 * passano dalla stessa funzione (`contaSenzaCancellare`): tutti e due devono dire quante foto
 * orfane del magazzino `cod-proof` la notte toglierebbe, e non toglierne nessuna.
 */

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno> } = { attuale: fintoGiroNotturno() };

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.attuale.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async () => ({ ok: true, fileRimossi: 0, erroriFile: [] }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-26T04:00:00Z').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

const RIDER = 'r1d3r000-0000-4000-8000-000000000001';
const ORDINE = '0d1e0000-0000-4000-8000-000000000001';

function richiesta(url: string) {
  return new Request(url, { method: 'POST', headers: { authorization: 'Bearer segreto-dei-lavori' } }) as never;
}

function preparaIlMagazzino() {
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      orders: [{ id: ORDINE, cash_photo_url: null, delivery_photo_url: `${RIDER}/${ORDINE}/porta-bis.jpg`, cash_signature_url: null }],
    },
    secchi: {
      'cod-proof': {
        '': [{ name: RIDER, id: null }],
        [RIDER]: [{ name: ORDINE, id: null }],
        [`${RIDER}/${ORDINE}`]: [
          // La foto viva: l'ordine la indica.
          { name: 'porta-bis.jpg', id: 'f1', created_at: giorniFa(20) },
          // Due foto rifatte che nessuna colonna indica più: la notte le toglierebbe.
          { name: 'porta.jpg', id: 'f2', created_at: giorniFa(20) },
          { name: 'contanti-vecchia.jpg', id: 'f3', created_at: giorniFa(20) },
        ],
      },
    },
  });
}

describe('il giro a mano e il conto a orario contano le foto di consegna orfane', () => {
  const salvato = { cron: process.env.CRON_SECRET, lavori: process.env.LAVORI_A_ORARIO, canc: process.env.CANCELLAZIONI_A_ORARIO };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    process.env.CRON_SECRET = 'segreto-dei-lavori';
    process.env.LAVORI_A_ORARIO = 'accesi';
    delete process.env.CANCELLAZIONI_A_ORARIO;
    preparaIlMagazzino();
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.CRON_SECRET = salvato.cron;
    if (salvato.lavori === undefined) delete process.env.LAVORI_A_ORARIO;
    else process.env.LAVORI_A_ORARIO = salvato.lavori;
    if (salvato.canc === undefined) delete process.env.CANCELLAZIONI_A_ORARIO;
    else process.env.CANCELLAZIONI_A_ORARIO = salvato.canc;
  });

  it.each([
    ['il giro a mano', 'http://localhost/api/cron/process-deletions?a_mano=1'],
    ['il conto della notte a cancellazioni spente', 'http://localhost/api/cron/process-deletions'],
  ])('%s conta 2 foto orfane e non ne toglie nessuna', async (_nome, url) => {
    const res = await POST(richiesta(url));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.soloConta).toBe(true);
    const voce = (corpo.fileDaTogliere as Array<{ cosa: string; file: number | null }> | undefined)?.find(
      (p) => p.cosa === 'prove-di-consegna-orfane',
    );
    expect(voce, 'il conto tace sulle foto di consegna orfane').toEqual({ cosa: 'prove-di-consegna-orfane', file: 2 });
    expect(mondo.attuale.diario.filter((v) => v.op === 'file-rimossi')).toEqual([]);
  });
});
