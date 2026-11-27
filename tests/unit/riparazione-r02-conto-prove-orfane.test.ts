import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * R02-006 (e il giro a mano) — IL CONTO PRIMA DI CANCELLARE MOSTRA ANCHE LE FOTO DI CONSEGNA ORFANE.
 *
 * La notte vera toglie dal magazzino `cod-proof` le foto che nessun ordine indica più
 * (potatureNotturne → prove-di-consegna-orfane). Il giro a mano che conta e non cancella
 * (`?a_mano=1`) contava solo i documenti d'identità orfani: chi lo leggeva prima di accendere
 * CANCELLAZIONI_A_ORARIO non vedeva le foto che la prima notte sarebbero sparite.
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

describe('il conto a mano conta le foto di consegna orfane', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    process.env.CRON_SECRET = 'segreto-dei-lavori';
    preparaIlMagazzino();
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.CRON_SECRET = salvato;
  });

  it('IL CASO CHE ROMPEVA — il conto dice quante foto orfane la notte toglierebbe, e non ne toglie nessuna', async () => {
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions?a_mano=1'));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.soloConta).toBe(true);
    const voce = (corpo.fileDaTogliere as Array<{ cosa: string; file: number | null }> | undefined)?.find(
      (p) => p.cosa === 'prove-di-consegna-orfane',
    );
    expect(voce, 'il conto a mano tace sulle foto di consegna orfane').toEqual({ cosa: 'prove-di-consegna-orfane', file: 2 });
    expect(String(corpo.nonContati)).toContain('foto di consegna orfane');
    const rimossi = mondo.attuale.diario.filter((v) => v.op === 'file-rimossi');
    expect(rimossi, 'il conto non deve togliere niente').toEqual([]);
  });

  it('i documenti d identità orfani restano nel conto accanto alle foto', async () => {
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions?a_mano=1'));
    const corpo = await res.json();
    const cose = (corpo.fileDaTogliere as Array<{ cosa: string }>).map((p) => p.cosa);
    expect(cose).toEqual(['documenti-kyc-orfani', 'prove-di-consegna-orfane']);
  });
});
