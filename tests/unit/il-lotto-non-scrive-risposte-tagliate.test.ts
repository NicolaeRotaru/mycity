import { describe, it, expect, vi } from 'vitest';

/**
 * 27/8/2026 (R144) — UNA RISPOSTA TAGLIATA A META' ENTRAVA IN VETRINA COME SE
 * FOSSE BUONA.
 *
 * Quando il modello finisce i token che gli abbiamo concesso, la risposta si
 * interrompe dove capita e lui lo dichiara: `stop_reason = "max_tokens"`.
 * Nessuna delle diciannove rotte AI leggeva quel campo, e il lavoro massivo sul
 * catalogo era il caso peggiore: `streamBatchResults` non lo riportava
 * nemmeno, quindi chi leggeva i risultati non avrebbe potuto controllarlo. Il
 * patch mezzo scritto arrivava a `apply`, che accetta qualunque stringa non
 * vuota, e finiva su decine di prodotti con un clic — nome troncato a metà
 * parola, descrizione che si interrompe — senza nessun errore.
 *
 * Il tetto della traduzione lo rendeva probabile davvero: 768 token per una
 * scheda di 4000 caratteri, con arabo e cinese fra le lingue ammesse, che
 * costano piu' token dell'italiano.
 *
 * Adesso una risposta tagliata è un errore per quel prodotto: si vede, e non
 * si scrive.
 */

import { parseCatalogBatchEntry, buildCatalogBatchRequests } from '@/lib/ai/catalogBatch';
import type { BatchResultEntry } from '@/lib/ai/batch';

const ID = '11111111-1111-1111-1111-111111111111';

function risultato(over: Partial<BatchResultEntry>): BatchResultEntry {
  return { customId: ID, status: 'succeeded', ...over };
}

describe('il lavoro massivo sul catalogo scarta le risposte interrotte', () => {
  it('un patch tagliato a meta non diventa una modifica da applicare', () => {
    const r = parseCatalogBatchEntry(
      'improve',
      risultato({
        stopReason: 'max_tokens',
        toolInput: { patch: { name: 'Lampada a sospensione in ottone anticato con paralum' } },
      }),
    );
    expect(
      r.patch,
      'la risposta si e interrotta a meta parola e il nome troncato sarebbe finito in vetrina',
    ).toBeUndefined();
    expect(r.error).toBe('risposta troncata');
  });

  it('anche una traduzione interrotta viene segnata come errore, non applicata', () => {
    const r = parseCatalogBatchEntry(
      'translate',
      risultato({ stopReason: 'max_tokens', toolInput: { patch: { name: 'Brass pendant la' } } }),
    );
    expect(r.patch).toBeUndefined();
    expect(r.error).toBe('risposta troncata');
  });

  it('un verdetto di conformita interrotto non passa come «prodotto a posto»', () => {
    const r = parseCatalogBatchEntry(
      'moderate',
      risultato({ stopReason: 'max_tokens', toolInput: { flagged: false } }),
    );
    expect(
      r.flagged,
      'il controllo di conformita si e interrotto e il prodotto e passato come ammesso',
    ).toBe(true);
    expect(r.error).toBe('risposta troncata');
  });

  it('una risposta finita normalmente continua a produrre il patch', () => {
    const r = parseCatalogBatchEntry(
      'improve',
      risultato({ stopReason: 'end_turn', toolInput: { patch: { name: 'Lampada LED' }, summary: 'ok' } }),
    );
    expect(r.patch).toEqual({ name: 'Lampada LED' });
    expect(r.error).toBeUndefined();
  });

  it('alla traduzione del lotto si danno abbastanza token per finire la frase', () => {
    // 768 token per una scheda tagliata a 4000 caratteri, in arabo o cinese,
    // e' il tetto che produceva le risposte tronche di cui sopra.
    const richieste = buildCatalogBatchRequests({
      operation: 'translate',
      products: [
        {
          id: ID, name: 'Lampada', description: 'x', price: 10, compare_at_price: null,
          unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: null,
          images: [], attributes: {}, tags: [], has_variants: false,
        },
      ],
      categories: [],
      targetLang: 'ar',
    });
    expect(richieste[0].max_tokens).toBeGreaterThanOrEqual(2048);
  });
});

describe('i risultati del lotto riportano come si e fermato il modello', () => {
  it('streamBatchResults porta su stop_reason, altrimenti nessuno puo controllarlo', async () => {
    vi.resetModules();
    vi.doMock('@/lib/ai/client', () => ({
      getAnthropic: () => ({
        messages: {
          batches: {
            results: async () => [
              {
                custom_id: ID,
                result: {
                  type: 'succeeded',
                  message: {
                    content: [{ type: 'tool_use', input: { patch: { name: 'tron' } } }],
                    stop_reason: 'max_tokens',
                    usage: { input_tokens: 10, output_tokens: 768 },
                  },
                },
              },
            ],
          },
        },
      }),
      MODELS: { fast: 'finto-veloce' },
    }));
    const { streamBatchResults } = await import('@/lib/ai/batch');
    const entries = [];
    for await (const e of streamBatchResults('batch_1')) entries.push(e);
    expect(entries).toHaveLength(1);
    expect(
      entries[0].stopReason,
      'il risultato del lotto non dice come si e fermato il modello: chi lo legge non puo accorgersi che e tagliato',
    ).toBe('max_tokens');
    vi.doUnmock('@/lib/ai/client');
  });
});
