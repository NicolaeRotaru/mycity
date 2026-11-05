import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S08 (5/11/2026) — Accettazione delle condizioni.
 *  · scheda 687: la rotta apre la sessione da sola e non passava dal controllo
 *    di provenienza di `authenticate()`;
 *  · scheda 2586: nessuna prova si accorgeva se il verbale si leggeva dalla
 *    riga più vecchia invece che dalla più recente.
 */

const stato: { consensi: Record<string, unknown>[] } = { consensi: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'consent_log') {
        return {
          insert: async (riga: Record<string, unknown>) => {
            stato.consensi.push(riga);
            return { error: null };
          },
          select: () => ({
            eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tos_accepted_at: null } }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  }),
}));

import { POST } from '@/app/api/account/accetta-condizioni/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { ultimaVersioneAVerbale } from '@/lib/legal/versione';

function accetta(headers: Record<string, string>) {
  return POST(new Request('https://mycity.test/api/account/accetta-condizioni', {
    method: 'POST',
    headers,
  }) as never);
}

beforeEach(() => {
  stato.consensi = [];
  __resetRateLimitBuckets();
});

describe('l accettazione delle condizioni guarda da dove arriva la richiesta (scheda 687)', () => {
  it('una pagina di un altro sito non mette a verbale un «accetto» a nome di chi è entrato', async () => {
    const res = await accetta({ origin: 'https://sito-ostile.example', 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(stato.consensi).toHaveLength(0);
  });

  it('dallo stesso sito la riga a verbale entra', async () => {
    const res = await accetta({ origin: 'https://mycity.test', 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(200);
    expect(stato.consensi).toHaveLength(1);
  });
});

describe('il verbale si legge dalla riga più recente (scheda 2586)', () => {
  it('ordina per data di creazione dalla più nuova alla più vecchia', async () => {
    // Un finto database che ordina DAVVERO: due righe, la vecchia coi 2.0 e la nuova coi 3.0.
    const righe = [
      { versione_testo: 'privacy-2.0+terms-2.0', created_at: '2026-09-01T10:00:00Z' },
      { versione_testo: 'privacy-2.0+terms-3.0', created_at: '2026-11-02T10:00:00Z' },
    ];
    const client = {
      from: () => {
        let elenco = [...righe];
        const catena = {
          select: () => catena,
          eq: () => catena,
          order: (colonna: string, { ascending }: { ascending: boolean }) => {
            elenco.sort((a, b) => {
              const x = String((a as Record<string, unknown>)[colonna]);
              const y = String((b as Record<string, unknown>)[colonna]);
              return ascending ? x.localeCompare(y) : y.localeCompare(x);
            });
            return catena;
          },
          limit: (n: number) => {
            elenco = elenco.slice(0, n);
            return catena;
          },
          maybeSingle: async () => ({ data: elenco[0] ?? null, error: null }),
        };
        return catena;
      },
    };
    expect(await ultimaVersioneAVerbale(client, 'u-1')).toBe('privacy-2.0+terms-3.0');
  });
});
