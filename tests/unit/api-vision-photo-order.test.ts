import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/vision/photo-order/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/photo-order', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
// #205 — Le foto devono stare su uno degli host dichiarati (il nostro Storage).
// Prima bastava che l'indirizzo cominciasse per http, e un venditore poteva far
// scaricare al modello — e mettere in vetrina — una foto ospitata altrove.
const STORAGE = 'https://abcdefgh.supabase.co/storage/v1/object/public/products';
const URLS = [`${STORAGE}/0.jpg`, `${STORAGE}/1.jpg`, `${STORAGE}/2.jpg`];
const URL_ESTRANEO = 'https://sito-di-un-altro.example/foto.jpg';

describe('POST /api/vision/photo-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: {
        order: [2, 0], // manca 1 → appeso in coda
        cover: 2,
        notes: [{ index: 1, note: 'sfocata' }, { index: 9, note: 'fuori range' }],
        tips: ['Usa luce naturale'],
      },
    });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq({ imageUrls: URLS }))).status).toBe(503);
  });
  it('400 con meno di 2 foto', async () => {
    expect((await POST(makeReq({ imageUrls: [URLS[0]] }))).status).toBe(400);
  });
  it('400 se le foto stanno su un sito che non è il nostro (#205)', async () => {
    const res = await POST(makeReq({ imageUrls: [URL_ESTRANEO, `${STORAGE}/1.jpg`] }));
    expect(res.status).toBe(400);
    expect(runMessageMock).not.toHaveBeenCalled();
  });
  it('200: order è permutazione completa, cover primo, note filtrate', async () => {
    const res = await POST(makeReq({ imageUrls: URLS }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order).toEqual([2, 0, 1]); // 1 mancante appeso
    expect(json.cover).toBe(2);
    expect(json.notes).toEqual([{ index: 1, note: 'sfocata' }]); // index 9 scartato
    expect(json.tips).toEqual(['Usa luce naturale']);
  });
});
