import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 — Il collaudo del calendario: Nicola non aveva un posto dove rileggere le visite di SDG fissate,
 * solo l'avviso. Ora la lista /admin/preventivi le mostra. Casi (dato → atteso):
 *  · un preventivo con la visita → la riga porta `visitaIl`; uno senza → null;
 *  · senza la colonna (999b non applicata) la lettura della visita fallisce, ma la lista si apre lo stesso.
 */

const stato = vi.hoisted(() => ({ erroreVisite: null as null | { message: string } }));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (gestore: (ctx: Record<string, unknown>) => unknown) => (req: Request) => gestore({ req, user: { id: 'admin-1' } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/agenzia/abbonamento-contanti', () => ({ fermaInContanti: vi.fn() }));
vi.mock('@/lib/supabase/server', () => {
  const risultato = (data: unknown, error: unknown = null) => Promise.resolve({ data, error });
  return {
    getAdminSupabase: () => ({
      from: (t: string) => ({
        select: (colonne: string) => {
          if (t === 'preventivi_con_codice' && colonne === 'seller_id, visita_il') {
            return { not: () => ({ limit: () => (stato.erroreVisite ? risultato(null, stato.erroreVisite) : risultato([{ seller_id: 'gc-1', visita_il: '2026-11-30T09:00:00.000Z' }])) }) };
          }
          if (t === 'preventivi_con_codice') {
            return { order: () => ({ limit: () => risultato([
              { seller_id: 'gc-1', codice: 'a'.repeat(64), stato: 'accettato', fascia_scelta: 'business', creato_il: '2026-11-27T10:00:00Z', accettato_il: '2026-11-27T17:00:00Z', profiles: { store_name: 'Grida Caffè' } },
              { seller_id: 'od-1', codice: 'b'.repeat(64), stato: 'aperto', fascia_scelta: null, creato_il: '2026-11-27T09:00:00Z', accettato_il: null, profiles: { store_name: 'Ora del Gusto' } },
            ]) }) };
          }
          if (t === 'schede_clienti') return { limit: () => risultato([]) };
          if (t === 'abbonamenti_servizi') return { eq: () => ({ in: () => ({ limit: () => risultato([]) }) }) };
          throw new Error(`tabella inattesa ${t}`);
        },
      }),
    }),
  };
});

import { GET } from '@/app/api/admin/preventivi-col-link/route';

const leggi = async () => (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('https://mycity.example/api/admin/preventivi-col-link'))).json();

beforeEach(() => { stato.erroreVisite = null; });

describe('la lista dei preventivi mostra la visita di SDG', () => {
  it('la riga col giorno scelto lo porta, l altra no', async () => {
    const corpo = await leggi();
    expect(corpo.ok).toBe(true);
    expect(corpo.data.map((r: { negozio: string; visitaIl: string | null }) => [r.negozio, r.visitaIl])).toEqual([
      ['Grida Caffè', '2026-11-30T09:00:00.000Z'],
      ['Ora del Gusto', null],
    ]);
  });

  it('senza la colonna (999b non applicata) la lista si apre lo stesso, senza visite', async () => {
    stato.erroreVisite = { message: 'column preventivi_con_codice.visita_il does not exist' };
    const corpo = await leggi();
    expect(corpo.ok).toBe(true);
    expect(corpo.data).toHaveLength(2);
    expect(corpo.data.every((r: { visitaIl: string | null }) => r.visitaIl === null)).toBe(true);
  });
});
