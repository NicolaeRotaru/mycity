import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 27/8/2026 (R135 · R142) — IL TETTO DI SPESA VERSO ANTHROPIC ERA UN NUMERO
 * NELLA MEMORIA DI UNA COPIA SOLA.
 *
 * `AI_GLOBAL_DAILY_BUDGET_EUR` prometteva «venti euro al giorno». Il contatore
 * che doveva farlo rispettare era una variabile dentro il file: su Vercel ogni
 * richiesta puo' finire su una copia diversa della funzione, e ogni copia parte
 * da zero. Venti euro al giorno diventavano venti euro PER COPIA e PER
 * risveglio — cioe' nessun tetto. Il primo segnale di un ciclo impazzito
 * sarebbe stata la fattura di fine mese.
 *
 * La finestra era anche sbagliata: ventiquattro ore contate dall'accensione di
 * quella copia, non il giorno di calendario.
 *
 * Adesso il conto vive in un posto solo, condiviso da tutte le copie (la
 * tabella `ai_spend_daily`, con la chiave del giorno di calendario). Queste
 * prove guardano il comportamento: se un'ALTRA copia ha gia' speso il budget,
 * questa deve rifiutarsi di chiamare il modello.
 */

const createMock = vi.fn();
const rpcMock = vi.fn();
const warnMock = vi.fn();

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: (...a: unknown[]) => warnMock(...a), error: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { runMessage, AiCallError } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';
import { __azzeraRipiegoSpesaAi, giornoDiSpesa } from '@/lib/ai/tettoSpesa';

function rispostaFinta(inTok: number, outTok: number) {
  return {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: inTok,
      output_tokens: outTok,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

/** Il magazzino condiviso finto: un solo numero, come la tabella vera. */
function magazzinoCondiviso(centesimiGiaSpesi: number) {
  const stato = { cents: centesimiGiaSpesi };
  rpcMock.mockImplementation(async (nome: string, args?: { p_cents?: number }) => {
    if (nome === 'spesa_ai_di_oggi') return { data: stato.cents, error: null };
    if (nome === 'registra_spesa_ai') {
      stato.cents += args?.p_cents ?? 0;
      return { data: stato.cents, error: null };
    }
    return { data: null, error: { message: 'rpc sconosciuta' } };
  });
  return stato;
}

const BUDGET = process.env.AI_GLOBAL_DAILY_BUDGET_EUR;

beforeEach(() => {
  vi.clearAllMocks();
  __azzeraRipiegoSpesaAi();
  process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '1';
});
afterEach(() => {
  if (BUDGET === undefined) delete process.env.AI_GLOBAL_DAILY_BUDGET_EUR;
  else process.env.AI_GLOBAL_DAILY_BUDGET_EUR = BUDGET;
});

describe('il tetto di spesa AI e uno solo per tutte le copie del sito', () => {
  it('se un altra copia ha gia bruciato il budget, qui non parte nessuna chiamata al modello', async () => {
    // Questa copia non ha speso niente: il suo contatore interno e' a zero.
    // Il conto condiviso pero' dice 1,50 € su un tetto di 1 €.
    magazzinoCondiviso(150);
    createMock.mockResolvedValue(rispostaFinta(10, 5));

    await expect(
      runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] }),
    ).rejects.toMatchObject({ name: 'AiCallError', status: 503 });

    expect(
      createMock,
      'il budget del giorno era gia finito su un altra copia, ma la chiamata a pagamento e partita lo stesso',
    ).not.toHaveBeenCalled();
  });

  it('la spesa fatta qui la vedono anche le altre copie', async () => {
    const magazzino = magazzinoCondiviso(0);
    createMock.mockResolvedValue(rispostaFinta(200_000, 100_000));

    await runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] });

    expect(
      magazzino.cents,
      'la chiamata e stata pagata ma il conto condiviso e rimasto a zero: le altre copie non sanno che sono usciti soldi',
    ).toBeGreaterThan(0);
    const registrazioni = rpcMock.mock.calls.filter(([n]) => n === 'registra_spesa_ai');
    expect(registrazioni.length).toBe(1);
    expect(registrazioni[0][1]).toMatchObject({ p_giorno: giornoDiSpesa() });
  });

  it('il conto si azzera al cambio di data, non ventiquattro ore dopo l accensione', () => {
    // Il giorno e' una data di calendario a Piacenza: due copie accese a ore
    // diverse devono guardare la STESSA casella.
    const mezzanotteEmezzo = new Date('2026-08-30T22:30:00Z'); // 00:30 del 31 a Piacenza
    expect(giornoDiSpesa(mezzanotteEmezzo)).toBe('2026-08-31');
    expect(giornoDiSpesa(new Date('2026-08-30T09:00:00Z'))).toBe('2026-08-30');
  });

  it('se il conto condiviso non risponde si continua a contare in casa, e lo si dice', async () => {
    // Un freno largo e' meglio di nessun freno: ma deve restare una traccia,
    // altrimenti nessuno sa che il tetto vero e' molto piu' alto di quello scritto.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'niente rete' } });
    createMock.mockResolvedValue(rispostaFinta(3_000_000, 3_000_000));

    await runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] });
    // La prima chiamata e' costata piu' di 1 €: la seconda va fermata dal
    // contatore di ripiego, senza magazzino condiviso.
    await expect(
      runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] }),
    ).rejects.toMatchObject({ status: 503 });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalled();
  });
});

describe('quando il conto condiviso non c e, non lo si chiama a ogni richiesta', () => {
  it('dopo qualche tentativo a vuoto si smette di provare, e si conta in casa', async () => {
    // Se la migrazione non e' ancora applicata, o il database e' giu', ogni
    // chiamata al modello pagherebbe un giro di rete buttato — proprio mentre
    // il database sta soffrendo. Si sospende e si riprova piu' tardi.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'funzione inesistente' } });
    createMock.mockResolvedValue(rispostaFinta(10, 5));
    for (let i = 0; i < 6; i++) {
      await runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] });
    }
    expect(createMock).toHaveBeenCalledTimes(6);
    expect(
      rpcMock.mock.calls.length,
      'il conto condiviso e rotto e lo si continua a interrogare a ogni chiamata al modello',
    ).toBeLessThan(6);
  });
});

describe('AiCallError resta il modo in cui il tetto si fa sentire', () => {
  it('e un errore con status 503, che le rotte traducono in «riprova domani»', () => {
    const e = new AiCallError('ai-prova', 503);
    expect(e.status).toBe(503);
  });
});
