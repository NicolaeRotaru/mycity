import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-002 (onda 2) — IL TETTO DI SPESA AI FRA COPIE CHE PARTONO INSIEME.
 *
 * Dopo l'onda 1, in produzione, il conto condiviso che non si legge ferma l'AI.
 * Restava il caso misurato dal revisore: la lettura del conto viva e la
 * scrittura rotta. Una copia nuova si fermava solo dopo la prima scrittura
 * fallita, a chiamata finita; intanto la prenotazione in memoria lasciava
 * passare le chiamate parallele fino al tetto, confrontandole con un conto che
 * non saliva mai (tetto 1 €, tre copie da duecento chiamate: 1,725 € spesi, conto
 * a zero). E anche con la scrittura viva, senza Upstash, tre copie partite
 * insieme leggevano lo stesso «speso» e passavano ognuna fino al tetto.
 *
 * Qui il database e' un client Supabase finto (mai quello vero) che fa quello
 * che fanno le funzioni della migrazione 999l e della 158; una «copia» e'
 * il modulo ricaricato da capo, e le tre copie lavorano INSIEME (Promise.all).
 * Il modello finto costa quanto la stima della chiamata (uscita = max_tokens).
 */

const finti = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));

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
    from: () => {
      const catena: Record<string, unknown> = {};
      for (const m of ['upsert', 'update', 'delete', 'select', 'eq', 'lt', 'maybeSingle']) catena[m] = () => catena;
      catena.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
      return catena;
    },
  }),
}));

const ADESSO = new Date('2026-11-28T11:00:00+01:00');
const OGGI = '2026-11-28';
const NEGATO = { data: null, error: { code: '42501', message: 'permission denied for table ai_spend_daily' } };
const ASSENTE = (nome: string) => ({
  data: null,
  error: { code: 'PGRST202', message: `Could not find the function public.${nome} in the schema cache` },
});

const giro = () => new Promise((ok) => setTimeout(ok, 0));

/** Il conto condiviso finto: una casella per giorno per tutte le copie, come `ai_spend_daily`. */
function contoCondivisoFinto(opzioni: { scrittura?: 'viva' | 'negata'; prenotazione?: 'c-e' | 'assente' } = {}) {
  const stato = { caselle: {} as Record<string, number>, scrittura: opzioni.scrittura ?? 'viva' };
  finti.rpc.mockImplementation(async (nome: string, a: { p_giorno: string; p_cents?: number; p_tetto_cents?: number }) => {
    await Promise.resolve(); // un giro di rete: le chiamate parallele si incrociano davvero
    const g = a.p_giorno;
    const adesso = stato.caselle[g] ?? 0;
    if (nome === 'spesa_ai_di_oggi') return { data: adesso, error: null };
    if (opzioni.prenotazione === 'assente' && (nome === 'prenota_spesa_ai' || nome === 'restituisci_spesa_ai')) return ASSENTE(nome);
    if (stato.scrittura === 'negata') return NEGATO;
    const cents = Math.max(0, a.p_cents ?? 0);
    if (nome === 'registra_spesa_ai') {
      stato.caselle[g] = adesso + cents;
      return { data: stato.caselle[g], error: null };
    }
    if (nome === 'prenota_spesa_ai') {
      const voluti = Math.max(1, cents);
      if (adesso + voluti > (a.p_tetto_cents ?? 0)) return { data: -1, error: null };
      stato.caselle[g] = adesso + voluti;
      return { data: stato.caselle[g], error: null };
    }
    if (nome === 'restituisci_spesa_ai') {
      stato.caselle[g] = Math.max(0, adesso - cents);
      return { data: stato.caselle[g], error: null };
    }
    return { data: null, error: { message: 'rpc sconosciuta' } };
  });
  return stato;
}

/** Il modello finto: risponde dopo un giro, e usa tutta l'uscita concessa (costo = stima). */
function modelloFinto() {
  finti.create.mockImplementation(async (corpo: { max_tokens: number }) => {
    await giro();
    return {
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: corpo.max_tokens, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    };
  });
}

/** Una copia nuova della funzione: modulo ricaricato = memoria vergine. */
async function unaCopiaNuova() {
  vi.resetModules();
  const run = await import('@/lib/ai/run');
  const { MODELS } = await import('@/lib/ai/client');
  const tetto = await import('@/lib/ai/tettoSpesa');
  tetto.__azzeraRipiegoSpesaAi();
  // Circa 2 centesimi a chiamata (uscita di MODELS.smart).
  const chiama = () => run.runMessage({ feature: 'ai-prova', model: MODELS.smart, max_tokens: 1200, messages: [] });
  return { chiama, tetto, run };
}

/** Tre copie, duecento chiamate parallele ciascuna, tutte nello stesso momento. Torna i soldi usciti. */
async function treCopieInsieme(): Promise<number> {
  const copie = [];
  for (let c = 0; c < 3; c++) copie.push(await unaCopiaNuova());
  const esiti = await Promise.allSettled(copie.flatMap(({ chiama }) => Array.from({ length: 200 }, () => chiama())));
  return esiti.reduce((somma, e) => somma + (e.status === 'fulfilled' ? e.value.usage.estCostEur : 0), 0);
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
  modelloFinto();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('in produzione la stima entra nel conto condiviso prima della chiamata', () => {
  beforeEach(produzione);

  it('conto leggibile ma scrittura rotta: tre copie da duecento chiamate parallele non chiamano il modello', async () => {
    const conto = contoCondivisoFinto({ scrittura: 'negata' });
    const speso = await treCopieInsieme();
    expect(
      speso,
      `con la scrittura del conto rotta tre copie hanno speso ${speso.toFixed(3)} € (tetto 1 €) e il conto e' a ${conto.caselle[OGGI] ?? 0}`,
    ).toBe(0);
    expect(finti.create, 'una chiamata a pagamento e partita senza che il conto condiviso la sapesse').not.toHaveBeenCalled();
  });

  it('la chiamata fermata dalla scrittura rotta e un errore temporaneo, non «budget finito»', async () => {
    contoCondivisoFinto({ scrittura: 'negata' });
    const { chiama } = await unaCopiaNuova();
    await expect(chiama()).rejects.toMatchObject({ name: 'AiCallError', status: 503, motivo: 'spesa_sconosciuta' });
  });

  it('senza Upstash, tre copie partite insieme non spendono piu del tetto del sito', async () => {
    const conto = contoCondivisoFinto();
    const speso = await treCopieInsieme();
    expect(speso, `tre copie insieme hanno speso ${speso.toFixed(3)} € su un tetto di 1,00 €`).toBeLessThanOrEqual(1);
    expect(speso, 'col conto condiviso vivo l AI deve lavorare').toBeGreaterThan(0.8);
    // Le prenotazioni si tolgono: nel conto resta la spesa vera (in centesimi interi), non le stime.
    expect(conto.caselle[OGGI]).toBeLessThanOrEqual(100);
    expect(conto.caselle[OGGI]).toBeGreaterThanOrEqual(Math.floor(speso * 100));
  });

  it('a chiamata finita nel conto resta la spesa vera, non la stima', async () => {
    const conto = contoCondivisoFinto();
    const { chiama } = await unaCopiaNuova();
    const r = await chiama();
    const prenotate = finti.rpc.mock.calls.filter(([n]) => n === 'prenota_spesa_ai');
    expect(prenotate, 'la stima non e stata prenotata nel conto condiviso').toHaveLength(1);
    expect(conto.caselle[OGGI]).toBe(Math.ceil(r.usage.estCostEur * 100));
  });

  it('senza la funzione della prenotazione (migrazione non applicata) l AI lavora come prima', async () => {
    const conto = contoCondivisoFinto({ prenotazione: 'assente' });
    const { chiama } = await unaCopiaNuova();
    const r = await chiama();
    expect(r.usage.estCostEur).toBeGreaterThan(0);
    expect(conto.caselle[OGGI]).toBe(Math.ceil(r.usage.estCostEur * 100));
  });

  it('una spesa vera non scritta resta coperta dalla prenotazione: non si toglie dal conto', async () => {
    const conto = contoCondivisoFinto();
    const { tetto } = await unaCopiaNuova();
    const p = await tetto.prenotaSpesaNelContoCondiviso(5, 100);
    expect(p.esito).toBe('prenotata');
    expect(conto.caselle[OGGI]).toBe(5);
    conto.scrittura = 'negata';
    await tetto.aggiungiSpesaCents(4); // la spesa vera non entra
    conto.scrittura = 'viva';
    if (p.esito === 'prenotata') await p.restituisci();
    // Della stima (5) si toglie solo quanto non copre la spesa vera (4): resta 4, non 0.
    expect(conto.caselle[OGGI], 'la prenotazione tolta ha portato via anche la spesa vera non scritta').toBe(4);
    // E quella spesa non e' piu' «da scrivere»: la lettura dopo non la conta una seconda volta.
    expect(await tetto.spesaDiOggiCents()).toBe(4);
    expect(conto.caselle[OGGI]).toBe(4);
  });
});

describe('fuori dalla produzione la copia e una sola: niente prenotazione nel database', () => {
  it('in sviluppo la chiamata non prenota nel conto condiviso', async () => {
    contoCondivisoFinto();
    const { chiama } = await unaCopiaNuova();
    await chiama();
    expect(finti.rpc.mock.calls.some(([n]) => n === 'prenota_spesa_ai')).toBe(false);
  });
});
