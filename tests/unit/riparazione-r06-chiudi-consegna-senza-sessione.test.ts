/**
 * R06 (27/11/2026) — Chi chiama la chiusura della consegna senza una sessione da
 * amministratore riceve «solo un amministratore» (403), non «chiusura non riuscita» (500).
 *
 * La funzione del database admin_chiudi_consegna (migrazione 360) è tolta ad anon
 * (REVOKE EXECUTE ... FROM anon): sul Postgres locale una chiamata da anon esce con
 * «42501 permission denied for function admin_chiudi_consegna», e PostgREST passa quel
 * codice al client. La strada del sito lo trattava come un guasto: 500, una riga d'errore
 * nei log e «riprova», mentre il problema è chi chiama. Un guasto vero resta un guasto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const stato = vi.hoisted(() => ({
  quadrature: [] as unknown[],
  errori: [] as unknown[][],
}));

vi.mock('@/lib/cassa/quadratura', () => ({
  aggiornaQuadratura: async (...a: unknown[]) => {
    stato.quadrature.push(a);
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => {
      stato.errori.push(a);
    },
    warn: vi.fn(),
    info: vi.fn(),
    spesa: vi.fn(),
  },
}));

vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }));

import { chiudiConsegnaDaAmministratore as chiudi } from '@/lib/cassa/registra-incasso';

const RICHIESTA = {
  ordineId: 'e1200000-0000-4000-8000-0000000000d1',
  incassatoCents: 2500,
  motivo: 'Fattorino irraggiungibile da tre giorni',
};

function sessioneCheRisponde(error: { code?: string; message?: string }) {
  const client = { rpc: async () => ({ data: null, error }) };
  return client as unknown as SupabaseClient;
}

/** Il client di servizio non va mai toccato da un rifiuto. */
const servizio = {
  from: () => {
    throw new Error('un rifiuto non rilegge l ordine');
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  stato.quadrature = [];
  stato.errori = [];
});

describe('la chiusura della consegna chiamata senza sessione da amministratore', () => {
  it('il permesso negato dal database è un 403 «solo un amministratore», non un guasto', async () => {
    const esito = await chiudi(
      sessioneCheRisponde({ code: '42501', message: 'permission denied for function admin_chiudi_consegna' }),
      servizio,
      RICHIESTA,
    );
    expect(esito).toEqual({
      ok: false,
      motivo: 'NOT_ADMIN',
      stato: 403,
      messaggio: 'Solo un amministratore può chiudere la consegna',
    });
    expect(stato.errori, 'chi chiama senza permesso non è un guasto da log').toHaveLength(0);
    expect(stato.quadrature).toHaveLength(0);
  });

  it('un guasto vero del database resta 500, e si scrive', async () => {
    const esito = await chiudi(
      sessioneCheRisponde({ code: '08006', message: 'connection failure' }),
      servizio,
      RICHIESTA,
    );
    expect(esito).toMatchObject({ ok: false, motivo: 'ERRORE', stato: 500 });
    expect(stato.errori).toHaveLength(1);
  });
});
