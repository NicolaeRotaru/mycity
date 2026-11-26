import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R12-001 (26/11/2026) — IN PRODUZIONE IL TETTO DI SPESA AI CONTAVA PER COPIA.
 *
 * Quando il conto condiviso (`spesa_ai_di_oggi` / `registra_spesa_ai`,
 * migrazione 131) non risponde — e in produzione non esiste proprio — ogni copia
 * della funzione ripiegava sul suo contatore in memoria. Su Vercel le copie sono
 * quante ne servono e ogni risveglio nasce con il contatore a zero: la quota
 * «tetto diviso tre» moltiplicata per le copie passava il tetto scritto.
 *
 * Qui il database e' un client Supabase finto (mai quello vero) e si guarda il
 * comportamento: in rete, con il conto condiviso giu', nessuna copia spende per
 * conto suo; con il conto condiviso vivo, il tetto e' uno solo e l'AI lavora.
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
  getAdminSupabase: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
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

const ADESSO = new Date('2026-11-26T11:00:00+01:00');

const ASSENTE = {
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' },
};
const TIMEOUT = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
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

/** Il conto condiviso finto: un numero solo per tutte le copie, come la tabella vera. */
function contoCondivisoFinto() {
  const stato = { cents: 0, scritturaRotta: false };
  rpcMock.mockImplementation(async (nome: string, args?: { p_cents?: number }) => {
    if (nome === 'spesa_ai_di_oggi') return { data: stato.cents, error: null };
    if (nome === 'registra_spesa_ai') {
      if (stato.scritturaRotta) return TIMEOUT;
      stato.cents += args?.p_cents ?? 0;
      return { data: stato.cents, error: null };
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
  const chiama = () =>
    run.runMessage({ feature: 'ai-prova', model: MODELS.fast, max_tokens: 50, messages: [] });
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '1'); // un euro al giorno per TUTTO il sito
  vi.stubEnv('AI_COPIE_ATTESE', '3');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NODE_ENV', 'test');
  createMock.mockResolvedValue(rispostaFinta());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('in produzione il tetto non diventa per copia quando il conto condiviso manca', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('dieci copie con la funzione del conto assente non spendono piu del tetto del sito', async () => {
    rpcMock.mockResolvedValue(ASSENTE);
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

  it('la prima chiamata di una copia nuova si ferma: nessuna chiamata a pagamento sul conto in memoria', async () => {
    rpcMock.mockResolvedValue(ASSENTE);
    const { chiama } = await unaCopiaNuova();
    await expect(chiama()).rejects.toMatchObject({ name: 'AiCallError', status: 503, motivo: 'tetto_spesa' });
    expect(createMock, 'la chiamata a pagamento e partita contando solo in memoria').not.toHaveBeenCalled();
  });

  it('anche un conto condiviso che non risponde (non assente) non fa contare la copia per se', async () => {
    rpcMock.mockResolvedValue(TIMEOUT);
    const { chiama, tetto } = await unaCopiaNuova();
    await expect(chiama()).rejects.toMatchObject({ status: 503, motivo: 'tetto_spesa' });
    expect(createMock).not.toHaveBeenCalled();
    expect(Number.isFinite(await tetto.spesaDiOggiCents()), 'la spesa di oggi non e nota: non e un numero').toBe(false);
  });

  it('una spesa che non si scrive nel conto condiviso ferma la copia finche non la scrive', async () => {
    const conto = contoCondivisoFinto();
    const { chiama } = await unaCopiaNuova();

    conto.scritturaRotta = true;
    await chiama(); // il conto si legge: la chiamata passa, ma la spesa non si scrive
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(conto.cents).toBe(0);

    await expect(
      chiama(),
      'la spesa di prima la conosce solo questa copia: le altre non la vedono, e qui si ripartiva come niente fosse',
    ).rejects.toMatchObject({ status: 503, motivo: 'tetto_spesa' });
    expect(createMock).toHaveBeenCalledTimes(1);

    conto.scritturaRotta = false;
    await chiama();
    const scritture = rpcMock.mock.calls.filter(([n]) => n === 'registra_spesa_ai').map(([, a]) => a as { p_cents: number });
    const recuperata = scritture.find((a, i) => i > 0 && a.p_cents > 0);
    expect(recuperata, 'la spesa rimasta indietro non e mai arrivata nel conto condiviso').toBeDefined();
    expect(conto.cents, 'il conto condiviso deve contenere le due chiamate pagate').toBeGreaterThan(0);
    expect(createMock).toHaveBeenCalledTimes(2);
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

/**
 * Il conto condiviso finto per le gare: una casella per giorno, e una scrittura
 * che si puo' tenere ferma a meta' per far entrare un'altra chiamata intanto.
 */
function contoConCaselle() {
  const caselle: Record<string, number> = {};
  const stato = {
    modo: 'rotto' as 'rotto' | 'trattieni' | 'vivo',
    sblocca: () => {},
    trattenuta: Promise.resolve(),
  };
  let entrata = () => {};
  stato.trattenuta = new Promise<void>((r) => {
    entrata = r;
  });
  rpcMock.mockImplementation(async (nome: string, args: { p_giorno: string; p_cents?: number }) => {
    if (nome === 'spesa_ai_di_oggi') return { data: caselle[args.p_giorno] ?? 0, error: null };
    if (nome !== 'registra_spesa_ai' || stato.modo === 'rotto') return TIMEOUT;
    if (stato.modo === 'trattieni') {
      // Questa scrittura riuscira', ma piu' tardi; quelle che arrivano intanto falliscono.
      stato.modo = 'rotto';
      const via = new Promise<void>((r) => {
        stato.sblocca = r;
      });
      entrata();
      await via;
    } else {
      await new Promise((r) => setTimeout(r, 2));
    }
    caselle[args.p_giorno] = (caselle[args.p_giorno] ?? 0) + (args.p_cents ?? 0);
    return { data: caselle[args.p_giorno], error: null };
  });
  return { caselle, stato };
}

describe('il resto da scrivere non perde e non raddoppia la spesa', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('una spesa non scritta mentre si scrive il resto resta da scrivere e arriva nel conto', async () => {
    const { caselle, stato } = contoConCaselle();
    const { tetto } = await unaCopiaNuova();
    await tetto.aggiungiSpesaCents(100); // non scritta: resto 100

    stato.modo = 'trattieni';
    const lettura = tetto.spesaDiOggiCents(); // scrive il resto, lentamente
    await stato.trattenuta;
    await tetto.aggiungiSpesaCents(50); // intanto: altri 50 che non si scrivono
    stato.modo = 'vivo';
    stato.sblocca();

    expect(await lettura).toBe(150);
    await tetto.spesaDiOggiCents();
    expect(
      caselle['2026-11-26'],
      'i 50 spesi durante la scrittura del resto sono spariti dal conto condiviso',
    ).toBe(150);
  });

  it('se intanto cambia il giorno, il resto vecchio va su ieri e la spesa nuova su oggi', async () => {
    const { caselle, stato } = contoConCaselle();
    const { tetto } = await unaCopiaNuova();
    vi.setSystemTime(new Date('2026-11-26T23:59:00+01:00'));
    await tetto.aggiungiSpesaCents(100); // resto del 26

    vi.setSystemTime(new Date('2026-11-27T00:10:00+01:00'));
    stato.modo = 'trattieni';
    const lettura = tetto.spesaDiOggiCents();
    await stato.trattenuta;
    await tetto.aggiungiSpesaCents(50); // spesa del 27, non scritta
    stato.modo = 'vivo';
    stato.sblocca();

    expect(await lettura).toBe(50);
    expect(caselle['2026-11-26']).toBe(100);
    expect(caselle['2026-11-27'], 'la spesa del 27 arrivata durante la scrittura e sparita').toBe(50);
  });

  it('due letture in parallelo della stessa copia scrivono il resto una volta sola', async () => {
    const { caselle, stato } = contoConCaselle();
    const { tetto } = await unaCopiaNuova();
    await tetto.aggiungiSpesaCents(100);

    stato.modo = 'vivo';
    const lette = await Promise.all([tetto.spesaDiOggiCents(), tetto.spesaDiOggiCents()]);
    expect(caselle['2026-11-26'], 'il resto e stato scritto due volte: il conto del sito sale del doppio').toBe(100);
    expect(lette).toEqual([100, 100]);
  });
});

describe('sul computer di chi sviluppa la copia e una sola: il ripiego resta', () => {
  it('senza Vercel ne build di produzione la spesa di ripiego e un numero', async () => {
    rpcMock.mockResolvedValue(ASSENTE);
    const { tetto } = await unaCopiaNuova();
    await tetto.aggiungiSpesaCents(30);
    expect(await tetto.spesaDiOggiCents()).toBe(30);
  });
});
