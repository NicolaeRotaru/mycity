import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (difetti minori, 5/11/2026) — le librerie AI: filtro dei prodotti vietati,
 * campi che il lotto non tocca, conto di riserva della spesa.
 */

const runMessageMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { classifyProductPolicy } from '@/lib/ai/moderation';
import { senzaCampiEconomici, parseCatalogBatchEntry } from '@/lib/ai/catalogBatch';
import { spesaDiOggiCents, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

beforeEach(() => {
  runMessageMock.mockReset();
  rpcMock.mockReset();
  __azzeraRipiegoSpesaAi();
});

describe('il filtro dei prodotti vietati accetta solo un sì scritto bene (253)', () => {
  for (const scritto of ['false', 'no', 1, { si: true }]) {
    it(`allowed=${JSON.stringify(scritto)} non passa`, async () => {
      runMessageMock.mockResolvedValue({ toolInput: { allowed: scritto } });
      const v = await classifyProductPolicy({ name: 'x', description: 'y' });
      expect(v.allowed).toBe(false);
    });
  }
  it('allowed=true passa', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { allowed: true } });
    expect((await classifyProductPolicy({ name: 'x', description: 'y' })).allowed).toBe(true);
  });
});

describe('«Migliora tutto il catalogo» non cambia l\'unità di prezzo (248)', () => {
  it('senzaCampiEconomici toglie unit', () => {
    expect(senzaCampiEconomici({ unit: 'kg', name: 'Pane' })).toEqual({ name: 'Pane' });
  });
  it('un risultato del lotto con unit esce senza unit', () => {
    const r = parseCatalogBatchEntry('improve', {
      customId: '11111111-1111-1111-1111-111111111111',
      status: 'succeeded',
      toolInput: { patch: { unit: 'kg', name: 'Pane casereccio' }, summary: 'ok' },
    });
    expect(r.patch).not.toHaveProperty('unit');
    expect(r.patch).toMatchObject({ name: 'Pane casereccio' });
  });
});

describe('il conto di riserva della spesa AI non si porta dietro ieri (251)', () => {
  it('dopo mezzanotte, se il database tace, la spesa di oggi non è quella di ieri', async () => {
    const ieri = new Date('2026-11-04T12:00:00Z');
    const oggi = new Date('2026-11-05T12:00:00Z');
    rpcMock.mockResolvedValueOnce({ data: 1900, error: null }); // ieri: 19 €
    expect(await spesaDiOggiCents(ieri)).toBe(1900);
    rpcMock.mockResolvedValueOnce({ data: 0, error: null }); // oggi: conto nuovo, zero
    expect(await spesaDiOggiCents(oggi)).toBe(0);
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } }); // poi tace
    expect(await spesaDiOggiCents(oggi)).toBe(0);
  });
});

describe('i testi degli elenchi del browser hanno un tetto di lunghezza (246)', () => {
  it('buildProductContext non porta nel prompt un\'opzione o una categoria enorme', async () => {
    const { buildProductContext } = await import('@/lib/ai/productContext');
    const enorme = 'x'.repeat(100_000);
    const blocchi = buildProductContext({
      product: { name: 'Pane' },
      attributeSchema: [{ key: enorme, type: 'select', options: Array.from({ length: 500 }, () => enorme) }],
      topCategories: [{ slug: enorme, name: enorme }],
    } as never);
    const testo = blocchi.map((b) => ('text' in b ? b.text : '')).join('');
    expect(testo.length).toBeLessThan(10_000);
  });
  it('rigaAttributoPerIlModello taglia chiave e opzioni', async () => {
    const { rigaAttributoPerIlModello } = await import('@/lib/products/aiPatch');
    const enorme = 'y'.repeat(50_000);
    const riga = rigaAttributoPerIlModello({ key: enorme, options: Array.from({ length: 200 }, () => enorme) });
    expect(riga.length).toBeLessThan(3_000);
  });
});

