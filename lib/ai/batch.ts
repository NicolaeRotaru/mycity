// lib/ai/batch.ts
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, type ModelId } from '@/lib/ai/client';

/**
 * Wrapper sottile sulla Message Batches API (job non realtime: moderazione
 * massiva, ri-descrizione catalogo, import listini). 50% di sconto, fino a 24h.
 *
 * Esperti senior consultati:
 * - Staff Backend: "Solo submit + poll + stream tipizzati. Niente logica di
 *   business qui: il chiamante costruisce le richieste e interpreta i risultati."
 * - FinOps/ML: "Batch = -50% sul token. Mai per richieste interattive."
 */

export type BatchRequest = {
  /** ID univoco lato chiamante. Pattern: ^[a-zA-Z0-9_-]{1,64}$ */
  custom_id: string;
  model: ModelId;
  max_tokens: number;
  system?: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.MessageCreateParams['tool_choice'];
};

export type BatchHandle = {
  id: string;
  processingStatus: Anthropic.Messages.MessageBatch['processing_status'];
  counts: Anthropic.Messages.MessageBatchRequestCounts;
  resultsUrl: string | null;
};

export type BatchResultEntry<TInput = unknown> = {
  customId: string;
  status: Anthropic.Messages.MessageBatchResult['type'];
  text?: string;
  toolInput?: TInput;
  errorType?: string;
  /** Quanto e' costata questa risposta, per il tetto di spesa giornaliero. */
  tokenIn?: number;
  tokenOut?: number;
  /**
   * 27/8/2026 (R144) — COME SI E' FERMATO IL MODELLO.
   *
   * Senza questo campo chi legge i risultati del lotto non poteva sapere che
   * una risposta era stata TAGLIATA a meta' perche' erano finiti i token
   * concessi (`max_tokens`): il patch mezzo scritto sembrava un patch buono, e
   * il pulsante «applica a tutti» lo scriveva in vetrina su decine di prodotti.
   */
  stopReason?: Anthropic.Message['stop_reason'];
};

function toHandle(b: Anthropic.Messages.MessageBatch): BatchHandle {
  return {
    id: b.id,
    processingStatus: b.processing_status,
    counts: b.request_counts,
    resultsUrl: b.results_url,
  };
}

/** Invia un batch. Mappa BatchRequest → shape SDK { custom_id, params }. */
export async function submitBatch(requests: BatchRequest[]): Promise<BatchHandle> {
  const client = getAnthropic();
  const batch = await client.messages.batches.create({
    requests: requests.map((r) => ({
      custom_id: r.custom_id,
      params: {
        model: r.model,
        max_tokens: r.max_tokens,
        ...(r.system ? { system: r.system } : {}),
        messages: r.messages,
        ...(r.tools ? { tools: r.tools } : {}),
        ...(r.tool_choice ? { tool_choice: r.tool_choice } : {}),
      },
    })),
  });
  return toHandle(batch);
}

/** Recupera lo stato di un batch (poll). `processingStatus === 'ended'` = pronto. */
export async function pollBatch(batchId: string): Promise<BatchHandle> {
  const client = getAnthropic();
  return toHandle(await client.messages.batches.retrieve(batchId));
}

/**
 * Stream dei risultati (solo se processingStatus === 'ended'). Parsa ogni
 * entry in testo + toolInput, coerente con runMessage.
 */
export async function* streamBatchResults<TInput = unknown>(
  batchId: string,
): AsyncGenerator<BatchResultEntry<TInput>> {
  const client = getAnthropic();
  for await (const entry of await client.messages.batches.results(batchId)) {
    if (entry.result.type === 'succeeded') {
      let text = '';
      let toolInput: TInput | undefined;
      for (const block of entry.result.message.content) {
        if (block.type === 'text') text += (text ? ' ' : '') + block.text;
        else if (block.type === 'tool_use' && toolInput === undefined) toolInput = block.input as TInput;
      }
      // 22/8/2026 — I TOKEN SPESI DAL LOTTO NON LI CONTAVA NESSUNO.
      // Ogni risposta porta con se' quanto e' costata: qui viene riportata su,
      // cosi' chi legge i risultati puo' registrarla sul tetto giornaliero come
      // fa `runMessage` per le chiamate singole.
      const uso = entry.result.message.usage;
      yield {
        customId: entry.custom_id,
        status: 'succeeded',
        text: text.trim(),
        toolInput,
        tokenIn: uso?.input_tokens ?? 0,
        tokenOut: uso?.output_tokens ?? 0,
        stopReason: entry.result.message.stop_reason,
      };
    } else {
      yield {
        customId: entry.custom_id,
        status: entry.result.type,
        errorType: entry.result.type === 'errored' ? entry.result.error.error.type : undefined,
      };
    }
  }
}
