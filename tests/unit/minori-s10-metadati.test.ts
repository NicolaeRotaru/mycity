import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiPerMetadati, dimenticaLettureDeiMetadati } from '@/lib/supabase/lettura-per-metadati';

/**
 * S10 (5/11/2026, scheda 571) — un intoppo del database non fa sparire da
 * Google una scheda vera: la lettura dei metadati lancia invece di dire «non c'è».
 */
const finto = (risposta: { data: unknown; error: unknown }) => {
  const query = { eq: () => query, single: async () => risposta };
  return { from: () => ({ select: () => query }) } as unknown as SupabaseClient;
};

beforeEach(() => dimenticaLettureDeiMetadati());

describe('un guasto non è «non trovato» (571)', () => {
  it('tempo scaduto → la lettura lancia', async () => {
    await expect(
      leggiPerMetadati('products', 'id', { id: 'p-1' }, finto({ data: null, error: { code: '57014', message: 'timeout' } })),
    ).rejects.toBeTruthy();
  });
  it('nessuna riga (PGRST116) → null', async () => {
    await expect(
      leggiPerMetadati('products', 'id', { id: 'p-2' }, finto({ data: null, error: { code: 'PGRST116' } })),
    ).resolves.toBeNull();
  });
});
