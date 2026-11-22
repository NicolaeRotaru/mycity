import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * GLI STRUMENTI AI SPENTI AL LANCIO LI FERMA LA ROTTA, NON SOLO LA PAGINA.
 *
 * lib/funzioni-al-lancio.ts dice che ogni interruttore lo legge anche la rotta. Dodici rotte AI
 * non leggevano AI_NEGOZI_ACCESA: chiamate a mano contavano il freno di frequenza, leggevano il
 * database e arrivavano fino alla chiave del modello. Qui, a interruttore spento, ognuna risponde
 * 503 senza toccare né il freno, né il database, né Anthropic; accesa, passa oltre (arriva al
 * freno di frequenza, che qui rifiuta per fermarla lì).
 */

const stato = vi.hoisted(() => ({
  aiAccesa: false,
  freno: 0,
  database: 0,
  anthropic: 0,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return { ...vero, get AI_NEGOZI_ACCESA() { return stato.aiAccesa; } };
});

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'seller-1' }, req }),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '1.2.3.4',
  rateLimitAsync: async () => { stato.freno += 1; return { allowed: false, retryAfterSec: 7 }; },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => { stato.database += 1; throw new Error('database non preparato per questa prova'); },
  getServerSupabase: async () => { stato.database += 1; throw new Error('database non preparato per questa prova'); },
}));

vi.mock('@/lib/env', async (originale) => {
  const vero = (await originale()) as { env: Record<string, unknown> };
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'chiave-finta' } };
});

vi.mock('@anthropic-ai/sdk', () => {
  class Finto {
    constructor() { stato.anthropic += 1; }
    messages = { create: async () => { stato.anthropic += 1; throw new Error('modello non preparato'); } };
  }
  return { default: Finto, Anthropic: Finto };
});

vi.mock('@/lib/ai/batch', () => ({
  submitBatch: async () => { stato.anthropic += 1; throw new Error('modello non preparato'); },
  pollBatch: async () => { stato.anthropic += 1; throw new Error('modello non preparato'); },
  fetchBatchResults: async () => { stato.anthropic += 1; throw new Error('modello non preparato'); },
  cancelBatch: async () => { stato.anthropic += 1; throw new Error('modello non preparato'); },
}));

const POST_CORPO = { productId: 'p1', jobId: 'job-1', name: 'Focaccia', text: 'Focaccia alta', question: 'È senza glutine?' };

const ROTTE: Array<{ nome: string; modulo: () => Promise<Record<string, unknown>>; metodo: 'GET' | 'POST' }> = [
  { nome: 'answer-qa', modulo: () => import('@/app/api/ai/answer-qa/route'), metodo: 'POST' },
  { nome: 'barcode-lookup', modulo: () => import('@/app/api/ai/barcode-lookup/route'), metodo: 'POST' },
  { nome: 'description', modulo: () => import('@/app/api/ai/description/route'), metodo: 'POST' },
  { nome: 'diagnose', modulo: () => import('@/app/api/ai/diagnose/route'), metodo: 'POST' },
  { nome: 'improve-product', modulo: () => import('@/app/api/ai/improve-product/route'), metodo: 'POST' },
  { nome: 'product-chat', modulo: () => import('@/app/api/ai/product-chat/route'), metodo: 'POST' },
  { nome: 'reviews-summary', modulo: () => import('@/app/api/ai/reviews-summary/route'), metodo: 'POST' },
  { nome: 'seo', modulo: () => import('@/app/api/ai/seo/route'), metodo: 'POST' },
  { nome: 'variants', modulo: () => import('@/app/api/ai/variants/route'), metodo: 'POST' },
  { nome: 'voice-product', modulo: () => import('@/app/api/ai/voice-product/route'), metodo: 'POST' },
  { nome: 'catalog-batch/status', modulo: () => import('@/app/api/ai/catalog-batch/status/route'), metodo: 'GET' },
  { nome: 'catalog-batch/cancel', modulo: () => import('@/app/api/ai/catalog-batch/cancel/route'), metodo: 'POST' },
];

async function chiama(r: (typeof ROTTE)[number]): Promise<Response> {
  const mod = await r.modulo();
  const gestore = mod[r.metodo] as (req: Request) => Promise<Response>;
  const url = `http://localhost/api/ai/${r.nome}${r.metodo === 'GET' ? '?jobId=job-1' : ''}`;
  const req = r.metodo === 'GET'
    ? new Request(url)
    : new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(POST_CORPO) });
  return gestore(req);
}

describe('gli strumenti AI spenti li ferma la rotta', () => {
  beforeEach(() => {
    stato.freno = 0;
    stato.database = 0;
    stato.anthropic = 0;
  });

  it.each(ROTTE.map((r) => [r.nome, r] as const))('%s, spenta: 503 e non tocca freno, database e modello', async (_n, r) => {
    stato.aiAccesa = false;
    const res = await chiama(r);
    expect(res.status).toBe(503);
    const corpo = await res.json();
    expect(JSON.stringify(corpo)).toContain('Gli strumenti AI per i negozi non sono ancora attivi.');
    expect(stato.freno).toBe(0);
    expect(stato.database).toBe(0);
    expect(stato.anthropic).toBe(0);
  });

  it.each(ROTTE.map((r) => [r.nome, r] as const))('%s, accesa: passa oltre l interruttore', async (_n, r) => {
    stato.aiAccesa = true;
    const res = await chiama(r);
    expect(res.status).toBe(429);
    expect(stato.freno).toBe(1);
  });
});
