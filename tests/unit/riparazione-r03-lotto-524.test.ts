import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

/**
 * R03-009 (ripresa) — Se l'invio di un lotto AI restava senza risposta, il sito
 * lo rimandava e Anthropic ne eseguiva due. Dopo il primo giro un 500/502/504 e
 * la connessione caduta valgono «forse partito»; restavano «fallito, riprova»
 * il 524 di Cloudflare (l'origine non ha risposto in tempo: proprio un invio
 * senza risposta) e un 2xx col corpo troncato (il lotto c'e', la risposta non
 * si legge). Qui il client vero dell'SDK parla con un fetch finto.
 */

const rete = vi.hoisted(() => ({ risposta: (): Response => new Response('{}') }));
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () =>
      new Anthropic({ apiKey: 'sk-ant-test', maxRetries: 0, fetch: (async () => rete.risposta()) as never }),
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

async function erroreDellInvio(r: () => Response): Promise<unknown> {
  rete.risposta = r;
  try {
    await submitBatch([RICHIESTA]);
  } catch (err) {
    return err;
  }
  throw new Error('l\'invio doveva fallire');
}

describe('un invio del lotto rimasto senza risposta vale «forse partito», non «fallito, riprova»', () => {
  it('524 di Cloudflare: forse partito', async () => {
    const err = await erroreDellInvio(() => new Response('<html>A timeout occurred</html>', { status: 524 }));
    expect(invioIncerto(err)).toBe(true);
  });

  it('2xx col corpo troncato: il lotto c\'e\', forse partito', async () => {
    const err = await erroreDellInvio(() => new Response(LOTTO.slice(0, 40), { status: 200, headers: JSON_H }));
    expect(invioIncerto(err)).toBe(true);
  });

  it('2xx col corpo vuoto: forse partito', async () => {
    const err = await erroreDellInvio(() => new Response('', { status: 200, headers: { ...JSON_H, 'content-length': '0' } }));
    expect(invioIncerto(err)).toBe(true);
  });

  it.each([503, 522, 529, 400])('%i: rifiuto prima dell\'invio, resta «fallito»', async (status) => {
    const err = await erroreDellInvio(() => new Response('{"type":"error","error":{"type":"api_error","message":"x"}}', { status, headers: JSON_H }));
    expect(invioIncerto(err)).toBe(false);
  });

  it('2xx leggibile: il lotto torna com\'e\'', async () => {
    rete.risposta = () => new Response(LOTTO, { status: 200, headers: JSON_H });
    const lotto = await submitBatch([RICHIESTA]);
    expect(lotto.id).toBe('msgbatch_1');
  });
});
