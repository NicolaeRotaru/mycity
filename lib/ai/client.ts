// lib/ai/client.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

/**
 * Client Anthropic centralizzato — server-only.
 *
 * Esperti senior consultati:
 * - Staff Backend: "Un solo punto di costruzione del client SDK. Niente
 *   `new Anthropic` sparso nelle route: chiave letta una volta, singleton
 *   riusato, errore di config tipizzato e gestibile a monte."
 * - FinOps/ML: "Tabella prezzi versionata nel codice = telemetria di costo
 *   deterministica e auditabile, base per il pannello 'Spesa AI'."
 * - Security: "Mai loggare la chiave. Mai importare questo modulo lato client."
 */

/** Modelli usati dal marketplace. `as const` per literal types stretti. */
export const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  vision: 'claude-sonnet-4-5',
  smart: 'claude-sonnet-4-5',
} as const;

export type ModelRole = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelRole];

/**
 * Prezzi Anthropic in USD per milione di token (fonte: claude.com/pricing).
 * `input`/`output` sono le tariffe base. La cache si deriva dai moltiplicatori
 * standard (vedi CACHE_MULTIPLIER). La conversione in EUR usa un tasso fisso
 * conservativo (USD_EUR) per non dipendere da una FX live e mantenere i log
 * riproducibili.
 */
export const PRICE_PER_MTOK = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
} as const satisfies Record<ModelId, { input: number; output: number }>;

/** Moltiplicatori cache (relativi al prezzo input base). */
export const CACHE_MULTIPLIER = { write5m: 1.25, read: 0.1 } as const;

/**
 * Tasso USD→EUR fisso e conservativo. La telemetria di costo non richiede
 * precisione FX al centesimo; un valore versionato evita chiamate di rete e
 * rende i log riproducibili. Aggiornabile in un singolo punto.
 */
export const USD_EUR = 0.92;

/**
 * #195 — La ricerca sul web si paga a richiesta, non a token: dieci dollari
 * ogni mille ricerche (tariffa Anthropic, versionata qui accanto ai prezzi per
 * milione di token). Non essendo contata, la spesa vera degli endpoint che
 * cercano — diagnosi, codice a barre, le due chat — risultava piu' bassa del
 * vero, e il freno di spesa si accendeva troppo tardi.
 */
export const USD_PER_WEB_SEARCH = 0.01;

export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number; // cache_creation_input_tokens
  cacheReadTokens: number; // cache_read_input_tokens
  /** Ricerche web fatte dal modello in questa chiamata (si pagano a richiesta). */
  webSearchRequests?: number;
};

/**
 * 27/8/2026 (R155) — LO SCONTO DEL LOTTO ERA SCRITTO SOLO NEI COMMENTI.
 *
 * L'intestazione di `lib/ai/batch.ts` dice, da quando esiste, «Batch = -50%
 * sul token». Il conto del costo non lo sapeva: applicava la tariffa piena, e
 * il numero che finiva nel tetto giornaliero e nella telemetria era circa il
 * doppio di quello che pagavamo davvero. Il tetto scattava prima del dovuto, e
 * il giorno in cui si decide quale funzione conviene guardando quel numero, si
 * decide su un dato gonfiato.
 *
 * Lo sconto vive qui, accanto alla tabella dei prezzi, cioè in un punto solo.
 */
export const SCONTO_LOTTO = 0.5;

/**
 * Stima il costo (in EUR) di una chiamata dato il modello e i token usati.
 * I token "input" passati sono i soli token non-cache (uncached): l'SDK
 * riporta input base, cache-write e cache-read in campi separati, quindi non
 * c'è doppio conteggio.
 *
 * `batch: true` per le richieste mandate con la Message Batches API, che
 * Anthropic fattura a metà tariffa. La ricerca sul web si paga a richiesta e
 * non è scontata (e nel lotto non c'è).
 */
export function estimateCostEur(
  model: ModelId,
  usage: AiUsageTokens,
  opts: { batch?: boolean } = {},
): number {
  const price = PRICE_PER_MTOK[model];
  const sconto = opts.batch ? SCONTO_LOTTO : 1;
  const perToken = (usd: number) => (usd * sconto) / 1_000_000;
  const usd =
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheWriteTokens * perToken(price.input * CACHE_MULTIPLIER.write5m) +
    usage.cacheReadTokens * perToken(price.input * CACHE_MULTIPLIER.read) +
    (usage.webSearchRequests ?? 0) * USD_PER_WEB_SEARCH;
  return usd * USD_EUR;
}

/** Codice d'errore stabile per "chiave AI non configurata". */
export const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED' as const;

/** Errore tipizzato con `code`, così le route possono distinguerlo. */
export class AiConfigError extends Error {
  readonly code = AI_NOT_CONFIGURED;
  constructor(message = 'Servizio AI non configurato (ANTHROPIC_API_KEY mancante).') {
    super(message);
    this.name = 'AiConfigError';
  }
}

let _client: Anthropic | null = null;

/**
 * Restituisce il singleton Anthropic. Lancia `AiConfigError`
 * (code = AI_NOT_CONFIGURED) se la chiave non è presente.
 * Server-only: non importare da componenti client.
 */
export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = env.anthropicKey();
  if (!apiKey) throw new AiConfigError();
  // 180 — Senza tetto di tempo, l'SDK aspetta fino a dieci minuti e ritenta due
  // volte: mezz'ora appesa su una singola richiesta, con la connessione del
  // negoziante bloccata e la rotta serverless che paga il tempo. Un minuto è più
  // di quanto serva a qualunque risposta utile.
  _client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return _client;
}

/** SOLO per test: azzera il singleton tra i casi. */
export function __resetAnthropicClient(): void {
  _client = null;
}
