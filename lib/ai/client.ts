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

export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number; // cache_creation_input_tokens
  cacheReadTokens: number; // cache_read_input_tokens
};

/**
 * Stima il costo (in EUR) di una chiamata dato il modello e i token usati.
 * I token "input" passati sono i soli token non-cache (uncached): l'SDK
 * riporta input base, cache-write e cache-read in campi separati, quindi non
 * c'è doppio conteggio.
 */
export function estimateCostEur(model: ModelId, usage: AiUsageTokens): number {
  const price = PRICE_PER_MTOK[model];
  const perToken = (usd: number) => usd / 1_000_000;
  const usd =
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheWriteTokens * perToken(price.input * CACHE_MULTIPLIER.write5m) +
    usage.cacheReadTokens * perToken(price.input * CACHE_MULTIPLIER.read);
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
  _client = new Anthropic({ apiKey });
  return _client;
}

/** SOLO per test: azzera il singleton tra i casi. */
export function __resetAnthropicClient(): void {
  _client = null;
}
