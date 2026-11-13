/**
 * R04-012 — La lettura di un prodotto da una foto andava in errore 500 se il
 * modello scriveva il motivo del rifiuto (o nome, descrizione, prezzo) in un
 * formato inatteso. Adesso l'uscita si controlla prima di usarla.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';


const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'cat-1' }, error: null }) }) }) }),
    }),
  })),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/vision/extract-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

// #207 — Il controllo del formato guardava i primi 4096 caratteri e non
// verificava che il tipo dichiarato corrispondesse al contenuto. Ora i primi
// byte devono essere davvero quelli di una JPEG o di una PNG: queste sono
// intestazioni vere, minime.
const JPEG_VERO = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
// GIF 1x1 vera: intestazione GIF89a. Serve a provare che il formato viene
// rifiutato con parole che lo nominano, non con un errore che parla d'altro.

const GOOD_TOOL = {
  name: 'Sedia',
  description: 'Sedia in legno',
  category_slug: 'casa',
  suggested_price_eur: 29.9,
  image_quality: { score: 0.9, issues: [] },
  alt_text: 'Sedia in legno chiaro',
  policy_ok: true,
};

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-product', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('uscita del modello in un formato inatteso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('motivo del rifiuto come oggetto: 400 con il messaggio generico, non 500', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...GOOD_TOOL, policy_ok: false, policy_reason: { motivo: 'armi' } } });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/non può essere pubblicato/);
  });

  it('nome, descrizione e prezzo non testuali non escono cosi\' come sono', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: { ...GOOD_TOOL, name: ['Sedia'], description: 42, suggested_price_eur: '29.9', category_slug: { x: 1 } },
    });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo.name).toBe('');
    expect(corpo.description).toBe('');
    expect(corpo.suggested_price).toBeNull();
    expect(corpo.category_slug).toBeNull();
  });
});
