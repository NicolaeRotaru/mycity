import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 8/9/2026 (lotto gravi, corsia 11) — IL TETTO DI SPESA AI VALEVA IL TRIPLO,
 * E LA PRIMA NOTIZIA SAREBBE STATA LA FATTURA.
 *
 * Il conto della spesa verso Anthropic vive in un posto solo (la tabella
 * `ai_spend_daily`, migrazione 131) proprio perche' su Vercel «la macchina» non
 * esiste: ogni richiesta puo' finire su una copia diversa della funzione. Ma
 * in produzione quella migrazione non e' mai stata applicata. Ogni lettura del
 * conto in comune falliva, ogni copia ripiegava sul suo contatore in memoria, e
 * `AI_GLOBAL_DAILY_BUDGET_EUR = 20` voleva dire venti euro PER COPIA.
 *
 * Il ripiego non era il difetto: il difetto era che ripiegare non cambiava
 * NIENTE nella decisione. Adesso, quando il conto in comune manca in modo
 * durevole, la quota di questa copia diventa il tetto diviso le copie che
 * possono essere in aria — cosi' la somma resta intorno al tetto scritto.
 *
 * Queste prove guardano il comportamento, non le parole:
 * · tre copie diverse, conto condiviso assente, spendono INSIEME al massimo il
 *   tetto del sito (col difetto ne spendevano tre volte tanto);
 * · la decisione e' una funzione pura che si esegue senza database;
 * · la spia rossa si accende quando il ripiego non e' piu' un inciampo.
 */

const createMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import {
  decidiSpesaAi,
  allarmiTettoSpesaAi,
  leggiCopieAttese,
  COPIE_ATTESE_PREDEFINITE,
  TIPO_ALLARME_TETTO_AI,
  type ContoCondivisoStato,
} from '@/lib/ai/decisioneTettoSpesa';
import {
  sondaContoCondiviso,
  spesaDiOggiCents,
  __azzeraRipiegoSpesaAi,
} from '@/lib/ai/tettoSpesa';

/** Il conto in comune risponde: il tetto e' quello del sito. */
const contoVivo: ContoCondivisoStato = { condiviso: true, permanente: false, motivo: '', daMinuti: 0 };
/** Il conto in comune non esiste proprio (funzione mancante): non passa da solo. */
const contoAssente: ContoCondivisoStato = {
  condiviso: false,
  permanente: true,
  motivo: 'Could not find the function public.spesa_ai_di_oggi',
  daMinuti: 0,
};
/** Un guasto di rete di pochi minuti: passera'. */
function contoGiu(daMinuti: number): ContoCondivisoStato {
  return { condiviso: false, permanente: false, motivo: 'niente rete', daMinuti };
}

describe('la decisione «posso ancora spendere?» si esegue senza database', () => {
  it('col conto in comune vivo il tetto e quello scritto, e non si divide niente', () => {
    const sotto = decidiSpesaAi({ tettoEur: 20, spesaCents: 1_999, conto: contoVivo });
    expect(sotto.consentito).toBe(true);
    expect(sotto.tettoEffettivoCents).toBe(2_000);
    expect(sotto.copieAttese).toBe(1);

    const sopra = decidiSpesaAi({ tettoEur: 20, spesaCents: 2_000, conto: contoVivo });
    expect(sopra.consentito).toBe(false);
    expect(sopra.motivo).toBe('tetto_superato');
  });

  it('senza conto in comune la quota di UNA copia e il tetto diviso le copie in aria', () => {
    const d = decidiSpesaAi({ tettoEur: 20, spesaCents: 0, conto: contoAssente, copieAttese: 3 });

    expect(d.ripiegoDurevole, 'un conto che non esiste non e un inciampo di passaggio').toBe(true);
    expect(
      d.tettoEffettivoCents * 3,
      'tre copie con questa quota spenderebbero piu del tetto del sito: il tetto si sta moltiplicando',
    ).toBeLessThanOrEqual(2_000);
    expect(d.tettoEffettivoCents).toBe(666);

    // La copia che ha gia' bruciato la sua quota si ferma, anche se il tetto
    // del sito (20 €) sarebbe lontanissimo.
    const finita = decidiSpesaAi({ tettoEur: 20, spesaCents: 700, conto: contoAssente, copieAttese: 3 });
    expect(finita.consentito).toBe(false);
    expect(finita.motivo).toBe('quota_di_ripiego_superata');
  });

  it('un guasto di passaggio non stringe niente: un freno largo e meglio di nessun freno', () => {
    const d = decidiSpesaAi({ tettoEur: 20, spesaCents: 1_500, conto: contoGiu(10), copieAttese: 3 });
    expect(d.ripiegoDurevole).toBe(false);
    expect(d.tettoEffettivoCents).toBe(2_000);
    expect(d.consentito).toBe(true);
  });

  it('ma un ripiego che dura da piu di un ora non e piu un guasto: la quota si stringe', () => {
    const unOra = decidiSpesaAi({ tettoEur: 20, spesaCents: 1_500, conto: contoGiu(60), copieAttese: 3 });
    expect(unOra.tettoEffettivoCents, 'a un ora esatta si tollera ancora').toBe(2_000);

    const oltre = decidiSpesaAi({ tettoEur: 20, spesaCents: 1_500, conto: contoGiu(61), copieAttese: 3 });
    expect(oltre.ripiegoDurevole).toBe(true);
    expect(oltre.tettoEffettivoCents).toBe(666);
    expect(oltre.consentito, 'la copia ha gia speso 15 € su una quota di 6,66 €').toBe(false);
  });

  it('senza tetto configurato non si blocca niente', () => {
    const d = decidiSpesaAi({ tettoEur: 0, spesaCents: 999_999, conto: contoAssente });
    expect(d.consentito).toBe(true);
    expect(d.motivo).toBe('nessun_tetto');
  });

  it('una spesa che non e un numero non e «zero speso»: con dei soldi in ballo si ferma', () => {
    const d = decidiSpesaAi({ tettoEur: 20, spesaCents: Number.NaN, conto: contoVivo });
    expect(d.consentito).toBe(false);
    expect(d.motivo).toBe('spesa_sconosciuta');
  });

  it('un numero di copie sporco non fa mai dividere per zero', () => {
    expect(leggiCopieAttese(undefined)).toBe(COPIE_ATTESE_PREDEFINITE);
    expect(leggiCopieAttese('')).toBe(COPIE_ATTESE_PREDEFINITE);
    expect(leggiCopieAttese('boh')).toBe(COPIE_ATTESE_PREDEFINITE);
    expect(leggiCopieAttese(0)).toBe(COPIE_ATTESE_PREDEFINITE);
    expect(leggiCopieAttese(-3)).toBe(COPIE_ATTESE_PREDEFINITE);
    expect(leggiCopieAttese('7')).toBe(7);

    const d = decidiSpesaAi({ tettoEur: 20, spesaCents: 0, conto: contoAssente, copieAttese: 0 });
    expect(Number.isFinite(d.tettoEffettivoCents)).toBe(true);
    expect(d.tettoEffettivoCents).toBeGreaterThan(0);
  });
});

describe('la spia rossa: quando il conto non e piu in comune lo si sa prima della fattura', () => {
  it('col conto vivo non si disturba nessuno', () => {
    expect(allarmiTettoSpesaAi(contoVivo, { tettoEur: 20 })).toEqual([]);
  });

  it('il conto che NON ESISTE e rosso subito: non passera mai da solo', () => {
    const allarmi = allarmiTettoSpesaAi(contoAssente, { tettoEur: 20, copieAttese: 3 });
    expect(allarmi).toHaveLength(1);
    expect(allarmi[0].type).toBe(TIPO_ALLARME_TETTO_AI);
    expect(allarmi[0].detail).toMatch(/migrazione/i);
    // La chiave serve al dedup: dentro non ci vanno pezzi che cambiano a ogni
    // passata, altrimenti lo stesso avviso riparte ogni volta.
    expect(allarmi[0].key).not.toMatch(/\d+ min|daMinuti/);
    expect(allarmi[0].key).toBe(`${TIPO_ALLARME_TETTO_AI}|assente`);
  });

  it('un guasto di venti minuti non e un allarme; uno di un ora e mezza si', () => {
    expect(allarmiTettoSpesaAi(contoGiu(20), { tettoEur: 20 })).toEqual([]);
    const allarmi = allarmiTettoSpesaAi(contoGiu(90), { tettoEur: 20 });
    expect(allarmi).toHaveLength(1);
    expect(allarmi[0].detail).toContain('90 min');
  });

  it('senza tetto configurato non c e nessuna promessa da mantenere', () => {
    expect(allarmiTettoSpesaAi(contoAssente, { tettoEur: 0 })).toEqual([]);
  });
});

describe('la sonda: la copia che sorveglia lo chiede al database, non alla sua memoria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __azzeraRipiegoSpesaAi();
  });

  it('col conto in comune vivo la sonda non ha niente da segnalare', async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const stato = await sondaContoCondiviso();
    expect(stato.condiviso).toBe(true);
    expect(allarmiTettoSpesaAi(stato, { tettoEur: 20 })).toEqual([]);
  });

  it('col conto in comune assente la sonda lo vede e la spia si accende', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' },
    });
    const stato = await sondaContoCondiviso();
    expect(stato.condiviso).toBe(false);
    expect(stato.permanente, 'una funzione che non esiste non torna da sola').toBe(true);
    expect(allarmiTettoSpesaAi(stato, { tettoEur: 20 })).toHaveLength(1);
  });

  it('la pausa del circuito non zittisce la sonda: quella pausa serve a chi spende, non a chi guarda', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'niente rete' } });
    // Tre letture a vuoto mettono in pausa il conto condiviso: da qui in poi
    // chi sta per spendere non fa piu' il giro di rete.
    for (let i = 0; i < 4; i++) await spesaDiOggiCents();
    const primaDellaSonda = rpcMock.mock.calls.length;
    expect(primaDellaSonda, 'la pausa non e mai scattata').toBeLessThan(4);

    await sondaContoCondiviso();
    expect(
      rpcMock.mock.calls.length,
      'la sonda non ha chiesto niente al database: da un altra copia direbbe «tutto a posto» senza aver guardato',
    ).toBeGreaterThan(primaDellaSonda);
  });
});

/**
 * LA PROVA VERA: tre copie della funzione, il conto in comune che non esiste
 * (e' esattamente lo stato della produzione), e si conta quanto escono a
 * spendere INSIEME. Col difetto: tre volte il tetto. Adesso: il tetto.
 */
describe('tre copie del sito non spendono tre volte il tetto', () => {
  const BUDGET = process.env.AI_GLOBAL_DAILY_BUDGET_EUR;
  const COPIE = process.env.AI_COPIE_ATTESE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '1'; // un euro al giorno per TUTTO il sito
    process.env.AI_COPIE_ATTESE = '3';
    // Il database di produzione: la funzione del conto condiviso non c'e'.
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' },
    });
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10_000,
        output_tokens: 2_000,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    });
  });
  afterEach(() => {
    if (BUDGET === undefined) delete process.env.AI_GLOBAL_DAILY_BUDGET_EUR;
    else process.env.AI_GLOBAL_DAILY_BUDGET_EUR = BUDGET;
    if (COPIE === undefined) delete process.env.AI_COPIE_ATTESE;
    else process.env.AI_COPIE_ATTESE = COPIE;
  });

  /** Una copia nuova della funzione: modulo ricaricato = contatore vergine. */
  async function unaCopiaSpendeFinoAlSuoLimite(): Promise<number> {
    vi.resetModules();
    const { runMessage } = await import('@/lib/ai/run');
    const { MODELS } = await import('@/lib/ai/client');
    let speso = 0;
    for (let i = 0; i < 500; i++) {
      try {
        const r = await runMessage({
          feature: 'ai-prova',
          model: MODELS.fast,
          max_tokens: 50,
          messages: [],
        });
        speso += r.usage.estCostEur;
      } catch {
        return speso; // il freno ha detto basta
      }
    }
    throw new Error('nessun freno: la copia ha fatto 500 chiamate a pagamento senza fermarsi');
  }

  it('col conto in comune assente, la somma delle tre copie resta dentro il tetto del sito', async () => {
    const copie = [
      await unaCopiaSpendeFinoAlSuoLimite(),
      await unaCopiaSpendeFinoAlSuoLimite(),
      await unaCopiaSpendeFinoAlSuoLimite(),
    ];
    const totale = copie.reduce((a, b) => a + b, 0);

    expect(copie.every((c) => c > 0), 'nessuna chiamata e passata: il freno ha chiuso tutto').toBe(true);
    expect(
      totale,
      `le tre copie hanno speso ${totale.toFixed(2)} € su un tetto di 1,00 €: il tetto si sta moltiplicando per il numero di copie`,
    ).toBeLessThanOrEqual(1.1);
    expect(totale, 'il freno e diventato cosi stretto da fermare quasi tutto').toBeGreaterThan(0.5);
  });
});
