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
  /** Tool schema opzionale; l'ultimo tool riceve cache_control ephemeral. */
  tools?: Anthropic.Tool[];
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

/** Applica cache_control ephemeral all'ultimo tool (schema stabile riusabile). */
function withToolCache(tools: Anthropic.Tool[] | undefined): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
  );
}

/** Errore lanciato quando l'SDK fallisce; porta lo status per il mapping. */
export class AiCallError extends Error {
  constructor(
    readonly feature: string,
    readonly status: number | undefined,
    readonly cause?: unknown,
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

/** Mappa errori SDK → ApiErrors. Non logga MAI l'errore raw. */
export function mapAiError(err: unknown, feature: string): NextResponse {
  const status = err instanceof AiCallError ? err.status : extractStatus(err);
  logger.error('AI call failed', { feature, status }); // solo status, mai raw
  if (status === 401) return ApiErrors.unavailable('Servizio AI non disponibile.');
  if (status === 429) return ApiErrors.rateLimited(60);
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
    throw new AiCallError(args.feature, extractStatus(err), err);
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
  };
  const estCostEur = estimateCostEur(args.model, usageTokens);

  // Telemetria aggregabile (feature, model, token, € stimati).
  logger.info('ai_usage', {
    feature: args.feature,
    model: args.model,
    inputTokens: usageTokens.inputTokens,
    outputTokens: usageTokens.outputTokens,
    cacheWriteTokens: usageTokens.cacheWriteTokens,
    cacheReadTokens: usageTokens.cacheReadTokens,
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
