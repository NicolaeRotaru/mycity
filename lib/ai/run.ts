// lib/ai/run.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getAnthropic, estimateCostEur, type ModelId } from '@/lib/ai/client';

/**
 * Esecuzione centralizzata di `messages.create`.
 *
 * Esperti senior consultati:
 * - Staff Backend: "Un solo path per ogni chiamata LLM: caching del prompt,
 *   telemetria di costo, mapping errori → ApiErrors. Le route non parlano mai
 *   direttamente con l'SDK."
 * - Prompt Engineer: "Input utente SEMPRE come dato dentro `messages`, mai
 *   nel system. Il system (istruzioni) è separato e cacheabile: confine netto
 *   = difesa contro prompt injection."
 * - Security: "Mai loggare l'errore raw (può contenere frammenti di chiave o
 *   input). Solo status code + feature."
 */

/** Blocco di testo per il system prompt, con cache opzionale. */
type SystemBlock = Anthropic.TextBlockParam;

export type RunMessageArgs = {
  /** Etichetta feature per la telemetria (es. 'ai-description', 'vision-extract'). */
  feature: string;
  /** ID modello già risolto (usare MODELS.fast / .vision / .smart). */
  model: ModelId;
  max_tokens: number;
  /**
   * Istruzioni di sistema. Stringa o blocchi. Vengono cacheate (ephemeral).
   * Tenere QUI le istruzioni; i dati utente vanno in `messages`.
   */
  system?: string | SystemBlock[];
  messages: Anthropic.MessageParam[];
  /**
   * Tool schema opzionali (custom e/o server tool come web_search). L'ultimo
   * tool *custom* (con `input_schema`) riceve cache_control ephemeral.
   */
  tools?: Anthropic.ToolUnion[];
  tool_choice?: Anthropic.MessageCreateParams['tool_choice'];
};

export type RunMessageResult<TInput = unknown> = {
  /** Testo unito di tutti i blocchi `text` (trim). Vuoto se nessun testo. */
  text: string;
  /** Input del primo blocco `tool_use`, se presente. */
  toolInput?: TInput;
  stopReason: Anthropic.Message['stop_reason'];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    estCostEur: number;
  };
  /** Risposta SDK grezza (escape hatch). */
  raw: Anthropic.Message;
};

/**
 * Applica cache_control ephemeral all'ultimo blocco di system. Caching
 * incrementale: il prefisso stabile (istruzioni) viene riusato tra chiamate,
 * abbattendo il costo di input.
 */
function buildSystem(system: RunMessageArgs['system']): string | SystemBlock[] | undefined {
  if (system === undefined) return undefined;
  const blocks: SystemBlock[] =
    typeof system === 'string' ? [{ type: 'text', text: system }] : system;
  if (blocks.length === 0) return undefined;
  return blocks.map((b, i) =>
    i === blocks.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b,
  );
}

/**
 * Applica cache_control ephemeral all'ultimo tool *custom* (con `input_schema`):
 * schema stabile riusabile. I server tool (es. web_search) non vengono cacheati
 * qui per non spostare il breakpoint di cache su una definizione gestita da Anthropic.
 */
function withToolCache(
  tools: Anthropic.ToolUnion[] | undefined,
): Anthropic.ToolUnion[] | undefined {
  if (!tools || tools.length === 0) return tools;
  let lastCustom = -1;
  tools.forEach((t, i) => {
    if ('input_schema' in t) lastCustom = i;
  });
  if (lastCustom === -1) return tools;
  return tools.map((t, i) =>
    i === lastCustom ? { ...t, cache_control: { type: 'ephemeral' } } : t,
  );
}

/**
 * Circuit breaker globale per il costo AI giornaliero (in-memory).
 * Si azzera a ogni cold start / deploy — accettabile: il suo scopo è fermare
 * abusi o bug di loop nella stessa istanza. AI_GLOBAL_DAILY_BUDGET_EUR
 * controlla il tetto (0 = disabilitato).
 */
const _aiBudget = { spentEur: 0, resetAt: Date.now() };

function _resetAiBudgetIfNeeded(): void {
  if (Date.now() - _aiBudget.resetAt > 86_400_000) {
    _aiBudget.spentEur = 0;
    _aiBudget.resetAt = Date.now();
  }
}

/**
 * 22/8/2026 — IL TETTO DI SPESA NON VEDEVA IL CANALE CHE SPENDE DI PIU'.
 *
 * Questi due ganci erano privati di questo file, e li chiamava solo
 * `runMessage`. Ma il canale che spende di piu' in un colpo solo non passa di
 * li': e' il LOTTO (`submitBatch`), che manda decine di richieste insieme.
 * Quello poteva partire col tetto gia' superato, e la spesa che faceva non
 * veniva contata da nessuna parte: il tetto restava fermo mentre i soldi
 * uscivano.
 *
 * Adesso sono esportati, e le rotte del lotto li usano come tutti gli altri.
 */
export function controllaTettoSpesaAi(feature: string): void {
  _checkAiBudget(feature);
}

export function registraSpesaAi(costEur: number): void {
  _recordAiCost(costEur);
}

function _checkAiBudget(feature: string): void {
  _resetAiBudgetIfNeeded();
  const limitEur = Number(process.env.AI_GLOBAL_DAILY_BUDGET_EUR ?? 0);
  if (limitEur > 0 && _aiBudget.spentEur >= limitEur) {
    logger.warn('ai_budget_exceeded', { feature, spentEur: _aiBudget.spentEur, limitEur });
    throw new AiCallError(feature, 503);
  }
}

function _recordAiCost(costEur: number): void {
  _resetAiBudgetIfNeeded();
  _aiBudget.spentEur += costEur;
}

/** Errore lanciato quando l'SDK fallisce; porta lo status per il mapping. */
export class AiCallError extends Error {
  constructor(
    readonly feature: string,
    readonly status: number | undefined,
    readonly cause?: unknown,
    /** Secondi di attesa dichiarati da Anthropic, quando l'header c'è. */
    readonly retryAfterSec?: number,
  ) {
    super(`AI call failed (${feature}, status=${status ?? 'n/a'})`);
    this.name = 'AiCallError';
  }
}

function extractStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err
    ? (err as { status?: number }).status
    : undefined;
}

/**
 * 22/8/2026 — QUANTO ASPETTARE, DETTO DA CHI CI STA LIMITANDO.
 *
 * Quando Anthropic ci limita rispondeva sempre «riprova fra un minuto», una
 * costante scritta nel codice, senza nessun rapporto con la finestra vera. Se
 * la finestra era di dieci secondi il venditore aspettava per niente; se era
 * di cinque minuti riprovava quattro volte a vuoto.
 *
 * L'header `retry-after` di quella risposta lo dice. Qui lo si legge — dagli
 * `Headers` del fetch o da un oggetto semplice, perché l'SDK usa entrambe le
 * forme — e si accetta solo un numero di secondi sensato: sotto zero o sopra
 * l'ora non è un'attesa, è un valore rotto.
 */
export function extractRetryAfter(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('headers' in err)) return undefined;
  const headers = (err as { headers?: unknown }).headers;
  let grezzo: unknown;
  if (headers instanceof Headers) grezzo = headers.get('retry-after');
  else if (typeof headers === 'object' && headers !== null) {
    grezzo = (headers as Record<string, unknown>)['retry-after'];
  }
  const secondi = Number(grezzo);
  if (!Number.isFinite(secondi) || secondi <= 0 || secondi > 3600) return undefined;
  return Math.ceil(secondi);
}

/** Mappa errori SDK → ApiErrors. Non logga MAI l'errore raw. */
export function mapAiError(err: unknown, feature: string): NextResponse {
  const status = err instanceof AiCallError ? err.status : extractStatus(err);
  logger.error('AI call failed', { feature, status }); // solo status, mai raw
  if (status === 401) return ApiErrors.unavailable('Servizio AI non disponibile.');
  if (status === 429) {
    // L'attesa la dichiara Anthropic; 60 secondi solo se non la dichiara.
    // Il margine casuale evita che tutti i venditori fermati insieme
    // ripartano nello stesso identico istante.
    const dichiarata =
      err instanceof AiCallError ? err.retryAfterSec : extractRetryAfter(err);
    return ApiErrors.rateLimited((dichiarata ?? 60) + Math.floor(Math.random() * 5));
  }
  if (status === 503) return ApiErrors.unavailable('Budget AI giornaliero esaurito. Riprova domani.');
  return ApiErrors.badGateway('Errore nel servizio AI. Riprova.');
}

/**
 * Esegue una chiamata `messages.create`, registra la telemetria di costo e
 * restituisce un risultato già parsato. In caso di errore SDK lancia
 * `AiCallError` (status estratto), così il chiamante decide come rispondere
 * — oppure usa `mapAiError` per la mappatura standard.
 */
export async function runMessage<TInput = unknown>(
  args: RunMessageArgs,
): Promise<RunMessageResult<TInput>> {
  // Circuit breaker: blocca se si è già superato il budget giornaliero.
  _checkAiBudget(args.feature);
  const client = getAnthropic(); // può lanciare AiConfigError (gestito a monte)

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: args.model,
      max_tokens: args.max_tokens,
      ...(args.system !== undefined ? { system: buildSystem(args.system) } : {}),
      messages: args.messages,
      ...(args.tools ? { tools: withToolCache(args.tools) } : {}),
      ...(args.tool_choice ? { tool_choice: args.tool_choice } : {}),
    });
  } catch (err) {
    throw new AiCallError(args.feature, extractStatus(err), err, extractRetryAfter(err));
  }

  // Parsing union-safe dei content block.
  let text = '';
  let toolInput: TInput | undefined;
  for (const block of response.content) {
    if (block.type === 'text') {
      text += (text ? ' ' : '') + block.text;
    } else if (block.type === 'tool_use' && toolInput === undefined) {
      toolInput = block.input as TInput;
    }
  }
  text = text.trim();

  // Usage: cache_* sono `number | null` nel tipo SDK 0.32.x → ?? 0.
  const u = response.usage;
  const usageTokens = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    // #195 — Le ricerche sul web si pagano a richiesta e non erano contate.
    webSearchRequests:
      (u as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0,
  };
  const estCostEur = estimateCostEur(args.model, usageTokens);

  // Accumula il costo reale nel circuit breaker dopo la chiamata riuscita.
  _recordAiCost(estCostEur);

  // Telemetria aggregabile (feature, model, token, € stimati). Esce sempre:
  // #195 — con logger.info in produzione non usciva affatto.
  logger.spesa('ai_usage', {
    feature: args.feature,
    model: args.model,
    inputTokens: usageTokens.inputTokens,
    outputTokens: usageTokens.outputTokens,
    cacheWriteTokens: usageTokens.cacheWriteTokens,
    cacheReadTokens: usageTokens.cacheReadTokens,
    webSearchRequests: usageTokens.webSearchRequests,
    estCostEur: Number(estCostEur.toFixed(6)),
  });

  return {
    text,
    toolInput,
    stopReason: response.stop_reason,
    usage: { ...usageTokens, estCostEur },
    raw: response,
  };
}
