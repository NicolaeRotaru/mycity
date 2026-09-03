// lib/ai/run.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getAnthropic, estimateCostEur, type ModelId } from '@/lib/ai/client';
import { aggiungiSpesaCents, euroInCents, spesaDiOggiCents } from '@/lib/ai/tettoSpesa';

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
  /**
   * Cosa farne se il modello si ferma perche' ha finito i token concessi.
   *
   * Assente = `rifiuta`, ed e' il punto di tutto: chi chiama non deve
   * RICORDARSI di controllare, deve DICHIARARE che una risposta a meta' gli va
   * bene. Chi non dice niente ottiene il comportamento sicuro.
   */
  seTagliata?: 'rifiuta' | 'accetta';
};

export type RunMessageResult<TInput = unknown> = {
  /** Testo unito di tutti i blocchi `text` (trim). Vuoto se nessun testo. */
  text: string;
  /** Input del primo blocco `tool_use`, se presente. */
  toolInput?: TInput;
  stopReason: Anthropic.Message['stop_reason'];
  /**
   * La risposta si e' fermata a meta' perche' erano finiti i token concessi.
   * Vero solo per chi ha chiesto `seTagliata: 'accetta'`: agli altri la
   * chiamata lancia e questa casella non arriva mai a essere letta.
   */
  tagliata: boolean;
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
 * 27/8/2026 (R156) — IL PUNTO DI ROTTURA DELLA CACHE SUL PEZZO CHE PESA.
 *
 * `buildSystem` e `withToolCache` mettono la cache sulle istruzioni e sullo
 * strumento: la parte piccola e stabile. Nelle due chat il pezzo grosso sta
 * altrove — il primo messaggio utente, che porta il catalogo del venditore,
 * fino a dieci miniature e le foto mandate ora, e viene ricostruito identico a
 * ogni turno. Su una conversazione di dieci messaggi pagavamo dieci volte lo
 * stesso catalogo e le stesse dieci immagini: la voce di costo piu' grossa
 * delle chat era l'unica che la cache non toccava.
 *
 * Il punto di rottura va in FONDO al contesto, non dopo la conversazione:
 * quello che viene dopo cambia a ogni turno, e un punto di rottura che si
 * sposta non fa riusare niente. Anthropic ne ammette quattro; qui il terzo.
 */
export function conCacheDelContesto(
  blocchi: Anthropic.ContentBlockParam[],
): Anthropic.ContentBlockParam[] {
  if (blocchi.length === 0) return blocchi;
  return blocchi.map((b, i) =>
    i === blocchi.length - 1 ? ({ ...b, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam) : b,
  );
}

/**
 * Il freno di spesa giornaliero verso Anthropic.
 *
 * 27/8/2026 (R135 · R142) — IL CONTATORE ERA IN MEMORIA DI UNA COPIA SOLA.
 *
 * Qui c'era `const _aiBudget = { spentEur: 0, resetAt: Date.now() }`, con un
 * commento che dichiarava la cosa «accettabile: si azzera a ogni cold start».
 * Su Vercel non e' accettabile: ogni richiesta puo' finire su una copia diversa
 * e ogni copia nasce col contatore vuoto, quindi «venti euro al giorno»
 * diventava venti euro moltiplicati per il numero di copie accese. Il tetto
 * c'era, ma non frenava: la prima notizia di un ciclo impazzito sarebbe
 * arrivata con la fattura.
 *
 * Adesso il conto sta in un posto solo — `lib/ai/tettoSpesa.ts`, tabella
 * `ai_spend_daily` — con la casella del giorno di calendario. Le firme dei due
 * ganci sono le stesse di prima tranne che ora sono asincrone: leggere e
 * scrivere un numero condiviso e' un giro di rete, non un'assegnazione.
 */
export async function controllaTettoSpesaAi(feature: string): Promise<void> {
  const limitEur = Number(process.env.AI_GLOBAL_DAILY_BUDGET_EUR ?? 0);
  if (!(limitEur > 0)) return; // nessun tetto configurato: niente giro di rete
  const spesiCents = await spesaDiOggiCents();
  if (spesiCents >= euroInCents(limitEur)) {
    logger.warn('ai_budget_exceeded', { feature, spentEur: spesiCents / 100, limitEur });
    throw new AiCallError(feature, 503);
  }
}

export async function registraSpesaAi(costEur: number): Promise<void> {
  await aggiungiSpesaCents(euroInCents(costEur));
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

/**
 * 3/9/2026 (R-lotto) — UNA RISPOSTA TAGLIATA A META' NON E' UNA RISPOSTA.
 *
 * Quando il modello finisce i token che gli abbiamo concesso si ferma dove
 * capita e lo dichiara: `stop_reason = 'max_tokens'`. Il testo si interrompe a
 * meta' parola; il blocco `tool_use` — cioe' il JSON con dentro nome,
 * descrizione o verdetto — arriva monco, e l'SDK lo consegna lo stesso come
 * oggetto, con i campi che era riuscito a scrivere.
 *
 * `runMessage` restituiva `stopReason` gia' da prima. Il guaio era che restava
 * una casella da guardare: nessuna delle diciassette chiamate la guardava, e
 * una descrizione tagliata a meta' finiva in vetrina, un verdetto di
 * conformita' interrotto passava per «prodotto a posto».
 *
 * Restituire il dato non basta, perche' si puo' dimenticare. Adesso il taglio
 * non e' un'informazione: e' un errore, e chi vuole la risposta a meta' deve
 * chiederla per nome (`seTagliata: 'accetta'`).
 */
export class AiRispostaTagliataError extends AiCallError {
  constructor(
    feature: string,
    /** Il tetto di token che ha fermato il modello: serve per capire di quanto alzarlo. */
    readonly maxTokens: number,
  ) {
    super(feature, 502);
    this.name = 'AiRispostaTagliataError';
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
  // La risposta c'era, ma finiva a meta': non e' un guasto del servizio, ed e'
  // giusto dirlo con parole diverse — chi legge deve capire che riprovando (o
  // chiedendo meno roba in una volta) la cosa puo' andare a buon fine.
  if (err instanceof AiRispostaTagliataError) {
    return ApiErrors.badGateway('La risposta si e interrotta prima della fine. Riprova.');
  }
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
  await controllaTettoSpesaAi(args.feature);
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

  // Accumula il costo reale nel conto condiviso dopo la chiamata riuscita.
  await registraSpesaAi(estCostEur);

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

  // IL TAGLIO SI CONTROLLA QUI, DOPO AVER MESSO IL COSTO NEL CONTO.
  //
  // L'ordine non e' un dettaglio: quei token li abbiamo pagati anche se la
  // risposta e' inservibile. Lanciare prima di `registraSpesaAi` renderebbe le
  // chiamate tagliate gratuite nel registro della spesa — e sono proprio quelle
  // che si tende a rilanciare, quindi il tetto giornaliero smetterebbe di
  // vedere la spesa che cresce di piu'.
  const tagliata = response.stop_reason === 'max_tokens';
  if (tagliata && args.seTagliata !== 'accetta') {
    logger.warn('ai_risposta_tagliata', {
      feature: args.feature,
      model: args.model,
      maxTokens: args.max_tokens,
      outputTokens: usageTokens.outputTokens,
    });
    throw new AiRispostaTagliataError(args.feature, args.max_tokens);
  }

  return {
    text,
    toolInput,
    stopReason: response.stop_reason,
    tagliata,
    usage: { ...usageTokens, estCostEur },
    raw: response,
  };
}
