import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * UN CONTO CONDIVISO MUTO DA PIU' DI UN'ORA E' UN ALLARME, NON UN AVVISO FRA CENTO.
 *
 * Quando il conto in comune della spesa AI tace, ogni copia del sito conta per
 * se'. Se l'errore dice «la funzione non esiste» l'allarme (`logger.error`,
 * che finisce in Sentry) partiva subito. Ma se il database risponde con un
 * guasto (timeout, connessione) e il guasto DURA, il codice restava a un
 * `warn` ogni cento chiamate per sempre — mentre `decidiSpesaAi` gia'
 * trattava quel ripiego come durevole e stringeva la quota. Il tetto cambiava
 * senza che nessuno venisse avvisato.
 *
 * Caso: guasto di rete che dura 61 minuti → atteso un `error` (una volta per
 * finestra di un'ora), non piu' solo warn.
 */

const rpcMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    spesa: vi.fn(),
    warn: (...a: unknown[]) => warnMock(...a),
    error: (...a: unknown[]) => errorMock(...a),
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { spesaDiOggiCents, aggiungiSpesaCents, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

const GUASTO = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
};

const PARTENZA = new Date('2026-11-01T10:00:00+01:00').getTime();

describe('un ripiego che dura si fa sentire anche quando non e «per sempre»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(PARTENZA);
    __azzeraRipiegoSpesaAi();
    rpcMock.mockResolvedValue(GUASTO);
  });
  afterEach(() => {
    __azzeraRipiegoSpesaAi();
    vi.useRealTimers();
  });

  it('nei primi minuti resta un avviso: un guasto di passaggio non e un allarme', async () => {
    await spesaDiOggiCents();
    vi.setSystemTime(PARTENZA + 20 * 60_000);
    await spesaDiOggiCents();
    expect(errorMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalled();
  });

  it('oltre un ora di ripiego parte l allarme, e dice che il tetto vale per copia', async () => {
    await spesaDiOggiCents();
    vi.setSystemTime(PARTENZA + 61 * 60_000);
    await aggiungiSpesaCents(50);
    expect(
      errorMock,
      'un tetto che da un ora vale per copia e non per il sito deve arrivare a chi sorveglia',
    ).toHaveBeenCalledTimes(1);
    const [messaggio] = errorMock.mock.calls[0] as [string];
    expect(messaggio).toMatch(/per copia/i);
    expect(messaggio, 'un timeout non si cura con la migrazione: non mandare a cercare la cosa sbagliata').not.toMatch(
      /migrazione/i,
    );
  });

  it('e non si ripete a ogni chiamata: una volta per finestra di un ora', async () => {
    await spesaDiOggiCents();
    vi.setSystemTime(PARTENZA + 61 * 60_000);
    for (let i = 0; i < 30; i++) await spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(PARTENZA + 125 * 60_000);
    await spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(2);
  });
});
