import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-002 (27/11/2026) — IN PRODUZIONE IL TETTO DI SPESA AI CONTAVA PER COPIA.
 *
 * In produzione le due funzioni del conto condiviso (`spesa_ai_di_oggi` /
 * `registra_spesa_ai`, migrazione 131) non ci sono: ogni chiamata falliva e ogni
 * copia della funzione ripiegava sul suo contatore in memoria. La quota «tetto
 * diviso AI_COPIE_ATTESE» non bastava: su Vercel le copie sono quante ne servono
 * e ogni risveglio nasce col contatore a zero, quindi la somma passava il tetto.
 *
 * Qui il database e' un client Supabase finto (mai quello vero), l'orologio e'
 * finto, e una «copia nuova» e' il modulo ricaricato da capo. Si guarda il
 * comportamento: in produzione, con il conto condiviso giu', nessuna copia
 * spende per conto suo; sul computer di chi sviluppa il ripiego resta com'era.
 */

const finti = vi.hoisted(() => ({
  create: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: (...a: unknown[]) => finti.create(...a) } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: (...a: unknown[]) => finti.rpc(...a),
    // La memoria degli allarmi (`operational_alert_log`): qui non conta, risponde vuota.
    from: () => {
      const catena: Record<string, unknown> = {};
      for (const m of ['upsert', 'update', 'delete', 'select', 'eq', 'lt', 'maybeSingle']) {
        catena[m] = () => catena;
      }
      catena.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
      return catena;
    },
  }),
}));

const ADESSO = new Date('2026-11-27T11:00:00+01:00');
const OGGI = '2026-11-27';

const ASSENTE = {
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' },
};
const TIMEOUT = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
};
const NEGATO = {
  data: null,
  error: { code: '42501', message: 'permission denied for function registra_spesa_ai' },
};

function rispostaFinta() {
  return {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10_000,
      output_tokens: 2_000,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

/** Il conto condiviso finto: una casella per giorno per tutte le copie, come la tabella vera. */
function contoCondivisoFinto() {
  const stato = { caselle: {} as Record<string, number>, scrittura: 'viva' as 'viva' | 'negata' };
  finti.rpc.mockImplementation(async (nome: string, args: { p_giorno: string; p_cents?: number }) => {
    if (nome === 'spesa_ai_di_oggi') return { data: stato.caselle[args.p_giorno] ?? 0, error: null };
    if (nome === 'registra_spesa_ai') {
      if (stato.scrittura === 'negata') return NEGATO;
      stato.caselle[args.p_giorno] = (stato.caselle[args.p_giorno] ?? 0) + (args.p_cents ?? 0);
      return { data: stato.caselle[args.p_giorno], error: null };
    }
    return { data: null, error: { message: 'rpc sconosciuta' } };
  });
  return stato;
}

/** Una copia nuova della funzione: modulo ricaricato = contatore in memoria vergine. */
async function unaCopiaNuova() {
  vi.resetModules();
  const run = await import('@/lib/ai/run');
  const { MODELS } = await import('@/lib/ai/client');
  const tetto = await import('@/lib/ai/tettoSpesa');
  tetto.__azzeraRipiegoSpesaAi();
  const chiama = () => run.runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] });
  return { chiama, tetto };
}

/** La copia spende finche' il freno non dice basta; torna quanto ha speso. */
async function spendeFinoAlFreno(chiama: () => Promise<{ usage: { estCostEur: number } }>): Promise<number> {
  let speso = 0;
  for (let i = 0; i < 500; i++) {
    try {
      speso += (await chiama()).usage.estCostEur;
    } catch {
      return speso;
    }
  }
  throw new Error('nessun freno: 500 chiamate a pagamento senza fermarsi');
}

function produzione() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'production');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '1'); // un euro al giorno per TUTTO il sito
  vi.stubEnv('AI_COPIE_ATTESE', '3');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  finti.create.mockResolvedValue(rispostaFinta());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('in produzione, senza conto condiviso, nessuna copia conta per se', () => {
  beforeEach(produzione);

  it('dieci copie con le funzioni del conto assenti non spendono piu del tetto del sito', async () => {
    finti.rpc.mockResolvedValue(ASSENTE);
    let totale = 0;
    for (let c = 0; c < 10; c++) {
      const { chiama } = await unaCopiaNuova();
      totale += await spendeFinoAlFreno(chiama);
    }
    expect(
      totale,
      `dieci copie hanno speso ${totale.toFixed(2)} € su un tetto di 1,00 €: ogni copia conta per se`,
    ).toBeLessThanOrEqual(1);
  });

  it('la prima chiamata di una copia nuova si ferma con un errore temporaneo, senza chiamare il modello', async () => {
    finti.rpc.mockResolvedValue(ASSENTE);
    const { chiama, tetto } = await unaCopiaNuova();
    await expect(chiama()).rejects.toMatchObject({ name: 'AiCallError', status: 503, motivo: 'spesa_sconosciuta' });
    expect(finti.create, 'la chiamata a pagamento e partita contando solo in memoria').not.toHaveBeenCalled();
    expect(Number.isNaN(await tetto.spesaDiOggiCents()), 'senza conto condiviso la spesa di oggi non e nota').toBe(true);
  });

  it('anche un conto che non risponde (timeout, non assente) non fa contare la copia per se', async () => {
    finti.rpc.mockResolvedValue(TIMEOUT);
    const { chiama } = await unaCopiaNuova();
    await expect(chiama()).rejects.toMatchObject({ status: 503, motivo: 'spesa_sconosciuta' });
    expect(finti.create).not.toHaveBeenCalled();
  });

  it('tre copie che leggono il conto ma non ci scrivono non spendono ognuna il tetto intero', async () => {
    const conto = contoCondivisoFinto();
    conto.scrittura = 'negata';
    let totale = 0;
    for (let c = 0; c < 3; c++) {
      const { chiama } = await unaCopiaNuova();
      totale += await spendeFinoAlFreno(chiama);
    }
    expect(
      totale,
      `tre copie hanno speso ${totale.toFixed(2)} € su un tetto di 1,00 € senza che il conto condiviso sapesse niente`,
    ).toBeLessThan(0.2);
  });

  it('una spesa che non si scrive ferma la copia finche non la scrive, poi arriva nel conto condiviso', async () => {
    const conto = contoCondivisoFinto();
    const { chiama } = await unaCopiaNuova();

    conto.scrittura = 'negata';
    await chiama(); // il conto si legge: la chiamata passa, ma la spesa non si scrive
    expect(finti.create).toHaveBeenCalledTimes(1);
    expect(conto.caselle[OGGI] ?? 0).toBe(0);

    await expect(
      chiama(),
      'la spesa di prima la conosce solo questa copia: le altre non la vedono',
    ).rejects.toMatchObject({ status: 503, motivo: 'spesa_sconosciuta' });
    expect(finti.create).toHaveBeenCalledTimes(1);

    conto.scrittura = 'viva';
    vi.setSystemTime(new Date(ADESSO.getTime() + 6 * 60_000)); // passata la pausa del circuito
    await chiama();
    expect(finti.create).toHaveBeenCalledTimes(2);
    const scritte = finti.rpc.mock.calls.filter(([n]) => n === 'registra_spesa_ai').map(([, a]) => (a as { p_cents: number }).p_cents);
    expect(scritte.filter((c) => c > 0).length, 'la spesa rimasta indietro non e mai arrivata nel conto condiviso').toBeGreaterThanOrEqual(4);
    expect(conto.caselle[OGGI], 'il conto condiviso deve contenere le due chiamate pagate').toBeGreaterThanOrEqual(2);
  });

  it('il resto si scrive una volta sola anche con due letture in parallelo, e non perde la spesa arrivata intanto', async () => {
    const conto = contoCondivisoFinto();
    const { tetto } = await unaCopiaNuova();
    conto.scrittura = 'negata';
    await tetto.aggiungiSpesaCents(100); // non scritta: resto 100
    conto.scrittura = 'viva';
    vi.setSystemTime(new Date(ADESSO.getTime() + 6 * 60_000));

    const lette = await Promise.all([tetto.spesaDiOggiCents(), tetto.spesaDiOggiCents()]);
    expect(conto.caselle[OGGI], 'il resto e stato scritto due volte: il conto del sito sale del doppio').toBe(100);
    expect(lette).toEqual([100, 100]);
  });

  it('con il conto condiviso vivo il tetto e uno solo per tutte le copie, e l AI lavora', async () => {
    contoCondivisoFinto();
    const spese: number[] = [];
    for (let c = 0; c < 3; c++) {
      const { chiama } = await unaCopiaNuova();
      spese.push(await spendeFinoAlFreno(chiama));
    }
    const totale = spese.reduce((a, b) => a + b, 0);
    expect(spese[0], 'col conto condiviso vivo l AI deve poter spendere').toBeGreaterThan(0.5);
    expect(totale).toBeLessThanOrEqual(1.1);
  });
});

describe('dove la copia e una sola il ripiego in memoria resta', () => {
  it('con vercel dev (next dev sotto Vercel) la spesa di ripiego e un numero', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'development');
    finti.rpc.mockResolvedValue(ASSENTE);
    const { tetto } = await unaCopiaNuova();
    await tetto.aggiungiSpesaCents(30);
    expect(await tetto.spesaDiOggiCents()).toBe(30);
  });

  it('nelle prove lanciate con le variabili di Vercel nel terminale la spesa di ripiego e un numero', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    finti.rpc.mockResolvedValue(ASSENTE);
    const { tetto } = await unaCopiaNuova();
    await tetto.aggiungiSpesaCents(30);
    expect(await tetto.spesaDiOggiCents()).toBe(30);
  });
});
