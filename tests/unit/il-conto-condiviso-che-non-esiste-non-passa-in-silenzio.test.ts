import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * IL TETTO DI SPESA AI IN PRODUZIONE NON ERA CONDIVISO, E NESSUNO POTEVA
 * SAPERLO.
 *
 * Il conto della spesa verso Anthropic vive in un posto solo — due funzioni del
 * database, `spesa_ai_di_oggi` e `registra_spesa_ai` (migrazione 131). In
 * produzione quelle due funzioni non ci sono mai state applicate. Ogni chiamata
 * tornava a vuoto, e il codice ripiegava sul contatore in memoria della singola
 * copia: su Vercel ogni richiesta puo' finire su una copia diversa, e ogni
 * copia parte da zero. «Venti euro al giorno» diventava venti euro per copia.
 *
 * Il ripiego era nato per un'assenza di minuti — il database che non risponde
 * adesso — e in produzione durava da sempre. La differenza fra le due
 * situazioni sta nel messaggio dell'errore, e il codice lo buttava via: un
 * guasto di passaggio e un conto che non esiste finivano nella stessa riga di
 * registro, un `warn` ogni cento chiamate.
 *
 * Qui la prova esegue tutte e due le situazioni e guarda cosa succede davvero.
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

import {
  spesaDiOggiCents,
  aggiungiSpesaCents,
  statoContoCondiviso,
  assenzaPermanente,
  __azzeraRipiegoSpesaAi,
} from '@/lib/ai/tettoSpesa';

/** Come risponde il database quando la funzione della migrazione 131 non c'e'. */
const FUNZIONE_ASSENTE = {
  data: null,
  error: {
    code: 'PGRST202',
    message: 'Could not find the function public.spesa_ai_di_oggi(p_giorno) in the schema cache',
  },
};

/** Come risponde quando il database c'e' ma in questo momento non ce la fa. */
const GUASTO_DI_PASSAGGIO = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
};

describe('un conto condiviso che non esiste si fa sentire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __azzeraRipiegoSpesaAi();
  });
  afterEach(() => {
    __azzeraRipiegoSpesaAi();
  });

  it('quando la migrazione non e applicata lo dice, e dice che e per sempre', async () => {
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    await spesaDiOggiCents();

    const stato = statoContoCondiviso();
    expect(stato.condiviso, 'il conto non e condiviso e il codice crede di si').toBe(false);
    expect(
      stato.permanente,
      'un conto che NON ESISTE non torna da solo: chiamarlo «guasto di passaggio» fa aspettare per sempre',
    ).toBe(true);
    expect(stato.motivo).toContain('spesa_ai_di_oggi');
  });

  it('e lo dice col registro giusto, nominando la migrazione che manca', async () => {
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    await spesaDiOggiCents();
    expect(
      errorMock,
      'un tetto di spesa che non frena piu non e un avviso fra cento: e un errore',
    ).toHaveBeenCalled();
    const [messaggio] = errorMock.mock.calls[0] as [string];
    expect(messaggio).toMatch(/migrazione 131/i);
    expect(messaggio, 'chi legge deve capire il danno senza aprire il codice').toMatch(/per copia/i);
  });

  it('non si ripete a ogni chiamata: una volta, e poi al massimo una all ora', async () => {
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    for (let i = 0; i < 50; i++) await spesaDiOggiCents();
    expect(errorMock, 'cinquanta righe uguali coprono gli errori veri').toHaveBeenCalledTimes(1);
  });

  it('chi sorveglia puo vedere da quanto dura, per farlo diventare rosso dopo un ora', async () => {
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    const partenza = Date.now();
    await spesaDiOggiCents();
    // La stessa domanda che si fara' l'allarme: «da quanti minuti va avanti?».
    expect(statoContoCondiviso(partenza + 61 * 60_000).daMinuti).toBeGreaterThanOrEqual(60);
    expect(statoContoCondiviso(partenza + 5 * 60_000).daMinuti).toBeLessThan(60);
  });

  it('un guasto di passaggio non grida «applica la migrazione»', async () => {
    rpcMock.mockResolvedValue(GUASTO_DI_PASSAGGIO);
    await spesaDiOggiCents();
    const stato = statoContoCondiviso();
    expect(stato.condiviso).toBe(false);
    expect(
      stato.permanente,
      'un timeout passa da solo: dire che manca la migrazione manda a cercare la cosa sbagliata',
    ).toBe(false);
    expect(errorMock).not.toHaveBeenCalled();
    expect(warnMock, 'ma qualcosa si deve dire lo stesso').toHaveBeenCalled();
  });

  it('quando il conto condiviso torna a rispondere, l allarme si spegne', async () => {
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    await spesaDiOggiCents();
    expect(statoContoCondiviso().condiviso).toBe(false);

    rpcMock.mockResolvedValue({ data: 42, error: null });
    await spesaDiOggiCents();
    const stato = statoContoCondiviso();
    expect(stato.condiviso, 'un allarme che non si spegne piu smette di voler dire qualcosa').toBe(true);
    expect(stato.permanente).toBe(false);
  });

  it('riconosce le forme in cui il database dice «non ce l ho»', () => {
    expect(assenzaPermanente({ code: 'PGRST202' })).toBe(true);
    expect(assenzaPermanente({ code: '42883' })).toBe(true);
    expect(assenzaPermanente({ message: 'relation "ai_spend_daily" does not exist' })).toBe(true);
    expect(assenzaPermanente({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(assenzaPermanente(null)).toBe(false);
  });
});

describe('il danno vero: senza conto condiviso ogni copia del sito conta per se', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __azzeraRipiegoSpesaAi();
  });

  it('la spesa di una copia non arriva alla copia accanto', async () => {
    // La «seconda copia» e' il modulo ricaricato da zero: e' esattamente cosa
    // succede su Vercel quando la richiesta finisce su un'altra istanza.
    rpcMock.mockResolvedValue(FUNZIONE_ASSENTE);
    await aggiungiSpesaCents(2000); // 20 € bruciati qui
    expect(await spesaDiOggiCents()).toBe(2000);

    vi.resetModules();
    const secondaCopia = await import('@/lib/ai/tettoSpesa');
    expect(
      await secondaCopia.spesaDiOggiCents(),
      'la seconda copia crede che oggi non sia stato speso niente: il tetto vale N volte',
    ).toBe(0);
    // …e questa e' la parte che prima non si vedeva: adesso quella copia SA di
    // essere cieca, e puo' dirlo invece di far finta che il numero sia buono.
    expect(secondaCopia.statoContoCondiviso().condiviso).toBe(false);
    secondaCopia.__azzeraRipiegoSpesaAi();
  });
});
