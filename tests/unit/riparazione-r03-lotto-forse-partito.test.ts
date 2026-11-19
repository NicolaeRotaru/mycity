import { describe, it, expect, afterEach, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

/**
 * R03-004 (giro 2) — Se l'invio di un lotto AI resta senza risposta, il sito non
 * deve dichiararlo «fallito, riprova»: Anthropic lo esegue lo stesso e il
 * secondo invio paga un secondo lotto. Dopo il primo giro restavano fuori:
 * - il 520 di Cloudflare (l'origine puo' essere caduta DOPO aver preso la richiesta);
 * - un 2xx col corpo che non e' un lotto (HTML di un proxy): submitBatch usciva
 *   con un lotto senza id;
 * - un 2xx col corpo che si ferma a meta': il timeout dell'SDK vale solo fino
 *   alle intestazioni, l'invio restava appeso fino ai 120 s di Vercel.
 * Il client vero dell'SDK parla con un fetch finto; i tempi con l'orologio finto.
 */

type Finto = (init: RequestInit | undefined) => Response;
const rete = vi.hoisted(() => ({ risposta: ((): Response => new Response('{}')) as (init: RequestInit | undefined) => Response }));
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () =>
      new Anthropic({
        apiKey: 'sk-ant-test',
        maxRetries: 0,
        timeout: 60_000,
        fetch: (async (_url: unknown, init?: RequestInit) => rete.risposta(init)) as never,
      }),
  };
});

import { invioIncerto, submitBatch } from '@/lib/ai/batch';

const RICHIESTA = {
  custom_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  model: 'claude-haiku-4-5-20251001' as const,
  max_tokens: 100,
  messages: [{ role: 'user' as const, content: 'x' }],
};
const JSON_H = { 'content-type': 'application/json' };
const LOTTO = '{"id":"msgbatch_1","type":"message_batch","processing_status":"in_progress","request_counts":{"processing":1,"succeeded":0,"errored":0,"canceled":0,"expired":0},"results_url":null}';

async function esitoDellInvio(r: Finto): Promise<unknown> {
  rete.risposta = r;
  try {
    return { lotto: await submitBatch([RICHIESTA]) };
  } catch (err) {
    return err;
  }
}

/** Un 2xx che manda l'inizio del lotto e poi si ferma; come fetch vero, cade solo se l'invio si interrompe. */
const corpoCheSiFerma: Finto = (init) => {
  const segnale = init?.signal ?? undefined;
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(LOTTO.slice(0, 30)));
      segnale?.addEventListener('abort', () => c.error(new DOMException('This operation was aborted', 'AbortError')));
    },
  });
  return new Response(corpo, { status: 200, headers: JSON_H });
};

describe('R03-004 — un invio del lotto rimasto a meta\' vale «forse partito», non «fallito, riprova»', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('520 di Cloudflare: l\'origine puo\' aver preso la richiesta, forse partito', async () => {
    const err = await esitoDellInvio(() => new Response('<html>Web server is returning an unknown error</html>', { status: 520 }));
    expect(err).toBeInstanceOf(Error);
    expect(invioIncerto(err)).toBe(true);
  });

  it('2xx con una pagina HTML al posto del lotto: niente lotto senza id, forse partito', async () => {
    const esito = await esitoDellInvio(
      () => new Response('<html><body>ok</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    expect(esito).toBeInstanceOf(Error);
    expect(invioIncerto(esito)).toBe(true);
  });

  it('2xx con un JSON che non e\' un lotto (senza id): forse partito', async () => {
    const esito = await esitoDellInvio(() => new Response('{"type":"message_batch"}', { status: 200, headers: JSON_H }));
    expect(esito).toBeInstanceOf(Error);
    expect(invioIncerto(esito)).toBe(true);
  });

  it('2xx col corpo che si ferma: l\'invio si interrompe da solo prima dei 120 s di Vercel, e vale «forse partito»', async () => {
    vi.useFakeTimers();
    let esito: unknown = 'appeso';
    void esitoDellInvio(corpoCheSiFerma).then((e) => {
      esito = e;
    });
    // Oltre il timeout dell'SDK (60 s): le intestazioni sono arrivate, il corpo no.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(esito).toBe('appeso');
    // Ben prima dei 120 s della funzione l'invio si e' fermato, con un errore «forse partito».
    await vi.advanceTimersByTimeAsync(39_000);
    expect(esito).not.toBe('appeso');
    expect(esito).toBeInstanceOf(Error);
    expect(invioIncerto(esito)).toBe(true);
  });

  it('2xx leggibile: il lotto torna com\'e\', e nessun orologio resta acceso', async () => {
    vi.useFakeTimers();
    const esito = (await esitoDellInvio(() => new Response(LOTTO, { status: 200, headers: JSON_H }))) as { lotto?: { id: string } };
    expect(esito.lotto?.id).toBe('msgbatch_1');
    expect(vi.getTimerCount()).toBe(0);
  });
});
