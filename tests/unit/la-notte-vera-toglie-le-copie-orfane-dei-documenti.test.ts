import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * 1/11/2026 — LA POTATURA DELLE COPIE ORFANE GIRA NELLA NOTTE VERA.
 *
 * `potatureNotturne` (lib/privacy/potature-ritenzione.ts) esisteva, ma la rotta
 * chiamava `eseguiPotature` con l'elenco di prima: il passo
 * `documenti-kyc-orfani` non partiva mai, e le carte d'identita' che nessun
 * profilo indica restavano nel secchio per sempre. Il conto senza cancellare,
 * invece, non deve toccare lo storage: resta sull'elenco di prima.
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

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

function preparaIlSecchio() {
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        // Il documento vivo: il profilo lo indica ancora.
        { id: 'u1', kyc_id_doc_front_url: 'u1/vivo.jpg' },
      ],
      notifications: [],
    },
    secchi: {
      'kyc-docs': {
        '': [{ name: 'u1', id: null }],
        u1: [
          { name: 'vivo.jpg', id: 'f1', created_at: giorniFa(40) },
          // La copia vecchia che nessun profilo indica piu'.
          { name: 'orfano.jpg', id: 'f2', created_at: giorniFa(40) },
        ],
      },
    },
  });
}

function richiesta(url: string) {
  return new Request(url, { method: 'POST', headers: { authorization: 'Bearer segreto-dei-lavori' } }) as never;
}

const rimossiDaiDocumenti = () =>
  mondo.attuale.diario.flatMap((v) => (v.op === 'file-rimossi' && v.secchio === 'kyc-docs' ? v.percorsi : []));

describe('la notte vera pota le copie orfane dei documenti d identita', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'segreto-dei-lavori';
    preparaIlSecchio();
  });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('IL CASO CHE ROMPEVA — la notte elenca il secchio e toglie la copia orfana, non quella viva', async () => {
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions'));
    const corpo = await res.json();
    expect(mondo.attuale.elenchi, 'la notte non ha nemmeno guardato il secchio dei documenti').toContain('kyc-docs:');
    expect(rimossiDaiDocumenti()).toEqual(['u1/orfano.jpg']);
    expect(corpo.retentionFallite ?? 0, 'il passo nuovo non deve far suonare la notte').toBe(0);
    expect(res.status).toBe(200);
  });

  it('IL CASO CHE ROMPEVA — il conto a mano dice quanti documenti orfani la notte toglierebbe, e non ne toglie nessuno', async () => {
    mondo.attuale = fintoGiroNotturno({
      tabelle: {
        profiles: [{ id: 'u1', kyc_id_doc_front_url: 'u1/vivo.jpg' }],
        notifications: [],
      },
      secchi: {
        'kyc-docs': {
          '': [{ name: 'u1', id: null }],
          u1: [
            { name: 'vivo.jpg', id: 'f0', created_at: giorniFa(40) },
            { name: 'o1.jpg', id: 'f1', created_at: giorniFa(40) },
            { name: 'o2.jpg', id: 'f2', created_at: giorniFa(30) },
            { name: 'o3.jpg', id: 'f3', created_at: giorniFa(20) },
            // Troppo giovane: la notte non lo toglierebbe, quindi non si conta.
            { name: 'nuovo.jpg', id: 'f4', created_at: giorniFa(1) },
          ],
        },
      },
    });
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions?a_mano=1&solo_conta=1'));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    const voce = (corpo.fileDaTogliere as Array<{ cosa: string; file: number | null }> | undefined)?.find(
      (p) => p.cosa === 'documenti-kyc-orfani',
    );
    expect(voce, 'il conto a mano tace sui documenti d identita').toEqual({ cosa: 'documenti-kyc-orfani', file: 3 });
    expect(rimossiDaiDocumenti(), 'il conto ha tolto file').toEqual([]);
    expect(mondo.attuale.diario.some((v) => v.op === 'file-rimossi')).toBe(false);
  });
});
