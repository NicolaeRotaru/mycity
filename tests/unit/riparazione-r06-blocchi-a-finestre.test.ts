/**
 * R06-001 (12/11/2026) — leggiInBlocchiTutte, provata da sola.
 *
 * Dentro ogni blocco di identificativi si legge a finestre di mille. Un errore a
 * meta' lettura deve risalire a chi chiama (una pagina in errore e' meglio di
 * numeri piu' bassi del vero), e il tetto duro deve accendere `troncato`.
 */
import { describe, it, expect } from 'vitest';
import { leggiInBlocchiTutte } from '@/lib/supabase/blocchi';

type Riga = { id: number };

describe('R06-001 · leggiInBlocchiTutte', () => {
  it('legge tutte le righe di un blocco oltre le mille', async () => {
    const r = await leggiInBlocchiTutte<Riga>(['a'], async (_b, da, a) => ({
      data: Array.from({ length: Math.max(0, Math.min(a, 1499) - da + 1) }, (_, i) => ({ id: da + i })),
      error: null,
    }));
    expect(r.error).toBeNull();
    expect(r.data.length).toBe(1500);
    expect(r.troncato).toBe(false);
  });

  it('un errore alla seconda finestra risale, non diventa «meno righe»', async () => {
    const r = await leggiInBlocchiTutte<Riga>(['a'], async (_b, da) =>
      da === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: 'tempo scaduto' } });
    expect(r.error?.message, 'L\'errore a meta\' lettura e\' sparito: la pagina avrebbe mostrato numeri piu\' bassi').toBe('tempo scaduto');
  });

  it('un errore nel secondo blocco risale', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const r = await leggiInBlocchiTutte<Riga>(ids, async (blocco) =>
      blocco.includes('id-120') ? { data: null, error: { message: 'giu' } } : { data: [{ id: 1 }], error: null });
    expect(r.error?.message).toBe('giu');
  });

  it('il tetto duro accende troncato', async () => {
    const r = await leggiInBlocchiTutte<Riga>(['a'], async (_b, da, a) => ({
      data: Array.from({ length: a - da + 1 }, (_, i) => ({ id: da + i })),
      error: null,
    }));
    expect(r.troncato).toBe(true);
  });
});

describe('R06-021 · leggiTutteLeRighe al tetto', () => {
  it('esattamente tante righe quante il tetto: completa, non troncata', async () => {
    const { leggiTutteLeRighe } = await import('@/lib/supabase/blocchi');
    const tutte = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
    const r = await leggiTutteLeRighe((da, a) => Promise.resolve({ data: tutte.slice(da, a + 1), error: null }), 3000);
    expect(r.data.length).toBe(3000);
    expect(r.troncato).toBe(false);
  });
  it('una riga oltre il tetto: troncata', async () => {
    const { leggiTutteLeRighe } = await import('@/lib/supabase/blocchi');
    const tutte = Array.from({ length: 3001 }, (_, i) => ({ id: i }));
    const r = await leggiTutteLeRighe((da, a) => Promise.resolve({ data: tutte.slice(da, a + 1), error: null }), 3000);
    expect(r.data.length).toBe(3000);
    expect(r.troncato).toBe(true);
  });
});
