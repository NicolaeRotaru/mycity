import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * L'«un errore all'ora» del conto della spesa AI si ricorda in una riga di operational_alert_log
 * ('ai-tetto-condiviso:errore-ripiego'): prima di parlare, un inserimento che ignora i doppioni,
 * poi un aggiornamento se la riga ha piu' di un'ora. Ma la pulizia della migrazione 660 (trigger
 * AFTER INSERT OR UPDATE, per istruzione) scatta anche sull'inserimento che non inserisce niente e
 * toglie le righe di piu' di 24 ore. Dopo un giorno di quiete la riga spariva proprio in mezzo:
 * l'aggiornamento non trovava niente, la funzione capiva «qualcuno ha gia' parlato» e il primo
 * errore taceva.
 *
 * Qui la tabella finta fa come il database: ogni INSERT o UPDATE, anche a vuoto, toglie dopo di
 * se' le righe di piu' di 24 ore (tranne 'ai-tetto-condiviso:ripiego-da', come la 660).
 */

const FUNZIONE_ASSENTE = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' } };
const righe = new Map<string, string>();
const errorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), spesa: vi.fn(), error: (...a: unknown[]) => errorMock(...a) },
}));

/** La pulizia della 660: dopo ogni istruzione di scrittura, via le righe di piu' di 24 ore. */
function pulizia() {
  const soglia = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  for (const [k, v] of [...righe]) if (v < soglia && k !== 'ai-tetto-condiviso:ripiego-da') righe.delete(k);
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: () => Promise.resolve(FUNZIONE_ASSENTE),
    from: () => ({
      upsert: (riga: { alert_key: string; last_sent_at: string }, o?: { ignoreDuplicates?: boolean }) => ({
        select: () => {
          let scritte: Array<{ alert_key: string }> = [];
          if (!(o?.ignoreDuplicates && righe.has(riga.alert_key))) {
            righe.set(riga.alert_key, riga.last_sent_at);
            scritte = [{ alert_key: riga.alert_key }];
          }
          pulizia();
          return Promise.resolve({ data: scritte, error: null });
        },
      }),
      update: (nuovo: { last_sent_at: string }) => ({
        eq: (_c: string, chiave: string) => ({
          lt: (_d: string, soglia: string) => ({
            select: () => {
              const ultima = righe.get(chiave);
              let prese: Array<{ alert_key: string }> = [];
              if (ultima !== undefined && ultima < soglia) {
                righe.set(chiave, nuovo.last_sent_at);
                prese = [{ alert_key: chiave }];
              }
              pulizia();
              return Promise.resolve({ data: prese, error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

/** Una copia nuova del sito: il modulo riletto da zero, senza la memoria di prima. */
async function nuovaCopia() {
  vi.resetModules();
  return import('@/lib/ai/tettoSpesa');
}

const ADESSO = new Date('2026-11-24T10:00:00Z');
const oreFa = (ore: number) => new Date(ADESSO.getTime() - ore * 60 * 60_000).toISOString();

describe('il primo errore del conto assente dopo un giorno di quiete si dice', () => {
  beforeEach(() => {
    righe.clear();
    errorMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(ADESSO);
  });
  afterEach(() => vi.useRealTimers());

  it('con la riga dell ultimo errore di 25 ore fa (la pulizia la toglie in mezzo) l errore parte', async () => {
    righe.set('ai-tetto-condiviso:errore-ripiego', oreFa(25));
    const copia = await nuovaCopia();
    await copia.spesaDiOggiCents();
    expect(errorMock, 'dopo un giorno di quiete il primo errore del ripiego tace').toHaveBeenCalledTimes(1);
    expect(righe.get('ai-tetto-condiviso:errore-ripiego'), 'la riga deve ricordare l errore appena detto').toBe(ADESSO.toISOString());
  });

  it('e la copia dopo, nella stessa ora, non lo ripete', async () => {
    righe.set('ai-tetto-condiviso:errore-ripiego', oreFa(25));
    await (await nuovaCopia()).spesaDiOggiCents();
    vi.setSystemTime(ADESSO.getTime() + 10 * 60_000);
    await (await nuovaCopia()).spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('CONTROLLO: con l ultimo errore di mezz ora fa non si ripete, con quello di due ore fa si dice', async () => {
    righe.set('ai-tetto-condiviso:errore-ripiego', oreFa(0.5));
    await (await nuovaCopia()).spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(0);

    righe.set('ai-tetto-condiviso:errore-ripiego', oreFa(2));
    await (await nuovaCopia()).spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(1);
  });
});
