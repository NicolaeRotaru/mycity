// lib/ai/batch.ts
import type Anthropic from '@anthropic-ai/sdk';
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
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

/**
 * 19/11/2026 (R03-004, giro 2) — Il tempo di tutto l'invio, risposta E corpo.
 * Il timeout del client (60 s) vale solo fino alle intestazioni: dopo un 2xx un
 * corpo che si ferma teneva l'invio appeso fino ai 120 s di Vercel, che
 * spegneva la funzione con la riga senza motivo. Allo scadere l'invio si
 * interrompe e vale «forse partito».
 */
const TEMPO_INVIO_LOTTO_MS = 70_000;

/** Invia un batch. Mappa BatchRequest → shape SDK { custom_id, params }. */
export async function submitBatch(requests: BatchRequest[]): Promise<BatchHandle> {
  const client = getAnthropic();
  const scadenza = new AbortController();
  // 12/11/2026 (R04-014) — NIENTE SECONDO INVIO AUTOMATICO.
  // Il client unico ritenta una volta dopo un timeout, e la creazione del lotto
  // non ha una chiave anti-doppione: se il primo invio era arrivato, presso
  // Anthropic partivano DUE lotti, e se ne pagavano due vedendone uno. Qui un
  // timeout resta un timeout: lo gestisce chi chiama, senza rimandare.
  const invio = client.messages.batches.create({
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
  }, { maxRetries: 0, signal: scadenza.signal });
  const orologio = setTimeout(() => scadenza.abort(), TEMPO_INVIO_LOTTO_MS);
  // 17/11/2026 (R03-009, ripresa) — Prima la risposta, poi il corpo. Una risposta
  // senza 2xx o una connessione caduta arrivano qui come sempre (vedi
  // `invioIncerto`). Dopo un 2xx il lotto c'e': se il corpo non si legge
  // (troncato, vuoto, fermo oltre il tempo) l'errore lo dice, e non diventa un
  // «fallito, riprova».
  let rispostaArrivata = false;
  let lotto: Anthropic.Messages.MessageBatch | undefined;
  try {
    if (typeof invio.asResponse === 'function') rispostaArrivata = (await invio.asResponse(), true);
    lotto = await invio;
  } catch (err) {
    if (rispostaArrivata || scadenza.signal.aborted) throw new RispostaDelLottoIlleggibile(err);
    throw err;
  } finally {
    clearTimeout(orologio);
  }
  // R03-004 (giro 2) — Un 2xx con un corpo che non e' un lotto (una pagina HTML,
  // del testo, un JSON senza id) usciva come lotto senza id: la riga restava
  // «in corso» senza niente da interrogare. Il lotto c'e', ma non si sa quale.
  if (!lotto || typeof lotto !== 'object' || typeof lotto.id !== 'string' || !lotto.id) {
    throw new RispostaDelLottoIlleggibile(lotto);
  }
  return toHandle(lotto);
}

/** Il lotto puo' essere creato, ma la risposta del fornitore non e' arrivata intera o non si legge. */
class RispostaDelLottoIlleggibile extends Error {
  constructor(readonly causa: unknown) {
    super('lotto forse creato, ma la risposta del fornitore non e\' arrivata intera o non si legge');
    this.name = 'RispostaDelLottoIlleggibile';
  }
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

/**
 * L'invio e' rimasto senza risposta (timeout, connessione caduta): il lotto
 * puo' essere partito oppure no. Non e' un «fallito» — se e' partito e' pagato.
 */
/** Il motivo scritto sulla riga di un invio incerto: lo stato lo riconosce da qui. */
export const INVIO_SENZA_RISPOSTA = 'invio senza risposta: il lotto potrebbe essere partito, da verificare';

/**
 * 17/11/2026 (R03-009) — Anche un 500, 502 o 504 del fornitore (errore interno,
 * gateway rotto o scaduto) puo' arrivare DOPO che il lotto e' stato creato:
 * trattarlo come «fallito» rimetteva il pulsante e il secondo invio pagava un
 * secondo lotto. Il 529 (sovraccarico) e gli altri dicono invece che la
 * richiesta non e' stata presa.
 *
 * Ripresa: anche il 524 di Cloudflare («l'origine non ha risposto in tempo»),
 * che e' proprio un invio rimasto senza risposta, e un 2xx col corpo
 * illeggibile. Giro 2: anche il 520 di Cloudflare (l'origine ha chiuso la
 * connessione o ha risposto in modo incomprensibile), che puo' arrivare DOPO
 * che l'origine ha preso la richiesta. Non il 503, il 522 o il 529: sono
 * rifiuti prima dell'invio.
 */
const STATUS_FORSE_PARTITO: ReadonlySet<number> = new Set([500, 502, 504, 520, 524]);

export function invioIncerto(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true;
  if (err instanceof RispostaDelLottoIlleggibile) return true;
  return err instanceof APIError && typeof err.status === 'number' && STATUS_FORSE_PARTITO.has(err.status);
}
