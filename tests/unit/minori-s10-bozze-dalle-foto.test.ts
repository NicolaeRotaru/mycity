import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026) — le bozze nate dalle foto e la dettatura.
 * 2632: un testo lungo scarta solo quel prodotto, non tutto il lotto.
 * 2621: un attributo dichiarativo che non entrerebbe comunque non scarta niente.
 * 2634: la creazione singola accetta ingredienti fino a 2000 caratteri.
 * 1700: la dettatura taglia i testi degli elenchi del browser e scarta i null.
 * 617, 1636: le istruzioni di «Genera con AI» e «Migliora tutto».
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
// 12/11/2026 (R04-006) — La rotta ora legge l'interruttore spento al lancio:
// qui si prova la funzione accesa, come prima.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

const CATEGORIES = [{ id: 'alim-top', name: 'Alimentari', slug: 'alimentari', parent_id: null }];
const insertMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'categories'
        ? { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) }
        : { insert: insertMock },
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, classifyProductPolicy: async () => ({ allowed: true }), assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST as bulk } from '@/app/api/ai/catalog-create-bulk/route';
import { POST as singola } from '@/app/api/ai/catalog-create/route';
import { POST as dettatura } from '@/app/api/ai/voice-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const req = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;

const FOTO = ['https://abcdefgh.supabase.co/storage/v1/object/public/products/a.jpg'];
const item = (draft: Record<string, unknown>) => ({
  imageUrls: FOTO,
  draft: { category_slug: 'alimentari', suggested_price: 4.5, ...draft },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  insertMock.mockImplementation((payload: unknown) => ({
    select: () => {
      const righe = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({ id: `n${i}`, ...(p as object) }));
      return Object.assign(Promise.resolve({ data: righe, error: null }), {
        single: async () => ({ data: righe[0], error: null }),
      });
    },
  }));
});

describe('un testo lungo scarta solo il suo prodotto (2632)', () => {
  it('alt di 400 caratteri e nome di 1000: il lotto nasce con gli altri prodotti', async () => {
    const res = await bulk(
      req('/api/ai/catalog-create-bulk', {
        items: [
          item({ name: 'Focaccia', alt_text: 'a'.repeat(400) }),
          item({ name: 'N'.repeat(1000) }),
          item({ name: 'Pane' }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = JSON.stringify(await res.json());
    expect(json).toMatch(/testo alternativo/);
    expect(json).toMatch(/nome/);
    const payloads = insertMock.mock.calls[0][0] as { name: string }[];
    expect(payloads.map((p) => p.name)).toEqual(['Pane']);
  });
});

describe('un attributo che non entrerebbe comunque non scarta il prodotto (2621)', () => {
  it('ingredienti di 2001 caratteri senza la spunta delle dichiarazioni: la bozza nasce', async () => {
    const res = await bulk(
      req('/api/ai/catalog-create-bulk', {
        items: [item({ name: 'Focaccia', dichiarazioni_confermate: false, attributes: { ingredienti: 'x'.repeat(2001) } })],
      }),
    );
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalled();
  });
});

describe('la creazione singola accetta una lista ingredienti vera (2634)', () => {
  it('900 caratteri di ingredienti entrano interi', async () => {
    const ingredienti = 'farina di grano tenero tipo 0, '.repeat(30).trim();
    const res = await singola(
      req('/api/ai/catalog-create', {
        imageUrls: FOTO,
        draft: { name: 'Focaccia', category_slug: 'alimentari', dichiarazioni_confermate: true, attributes: { ingredienti, allergeni: 'Glutine' } },
      }),
    );
    expect(res.status).toBe(200);
    expect((insertMock.mock.calls[0][0] as { attributes: Record<string, string> }).attributes.ingredienti).toBe(ingredienti);
  });
  it('oltre 2000 il messaggio dice quale campo', async () => {
    const res = await singola(
      req('/api/ai/catalog-create', {
        imageUrls: FOTO,
        draft: { name: 'Focaccia', category_slug: 'alimentari', dichiarazioni_confermate: true, attributes: { ingredienti: 'x'.repeat(2001) } },
      }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/ingredienti/);
  });
});

describe('la dettatura non porta nel prompt testi enormi dal browser (1700)', () => {
  it('opzioni e nomi tagliati, elementi null scartati', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'Ok', patch: { name: 'Pane' } } });
    const enorme = 'z'.repeat(200_000);
    const res = await dettatura(
      req('/api/ai/voice-product', {
        transcript: 'pane casereccio da un chilo a tre euro',
        attributeSchema: [null, { key: 'peso', type: 'select', options: [enorme, enorme] }],
        topCategories: [null, { slug: 'alimentari', name: enorme }],
      }),
    );
    expect(res.status).toBe(200);
    const prompt = JSON.stringify(runMessageMock.mock.calls[0][0].messages);
    expect(prompt.length).toBeLessThan(20_000);
  });
});

describe('le istruzioni non invitano a inventare (617, 1636)', () => {
  it('«Genera con AI» dice di non inventare e non invita alla provenienza locale', () => {
    const src = readFileSync('app/api/ai/description/route.ts', 'utf8');
    expect(src).toMatch(/Non inventare: niente ingredienti, materiali, origine/);
    expect(src).not.toMatch(/menzionare provenienza locale/);
    expect(src).toMatch(/recinta\('descrizione', attuale, MAX_DESCRIZIONE_PRODOTTO\)/);
  });
  it('«Migliora tutto» non chiede gli ingredienti nella descrizione', () => {
    const src = readFileSync('app/api/ai/improve-product/route.ts', 'utf8');
    expect(src).not.toMatch(/materiali\/ingredienti/);
    expect(src).toMatch(/Non elencare ingredienti né allergeni/);
  });
});
