import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-006 — Il freno di sei ore sui prodotti in errore reggeva solo con Upstash: senza, ogni copia
 * del sito aveva il suo contatore e ripagava le chiamate AI. Adesso l'ora dell'ultimo errore sta nel
 * database (products.external_sync_error_at) e la vedono tutte le copie. Orologio finto.
 */
const stato = vi.hoisted(() => ({
  erroreAt: null as string | null,
  letturaFallita: false,
  contatoreConsente: true,
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: stato.contatoreConsente, remaining: 0, retryAfterSec: 0, limit: 1 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          stato.letturaFallita
            ? { data: null, error: { message: 'colonna assente' } }
            : { data: { external_sync_error_at: stato.erroreAt }, error: null },
      });
      return q;
    },
  }),
}));

import { ritentoDopoErroreConsentito } from '@/lib/products/externalSync';

const ORA = new Date('2026-11-26T12:00:00Z');
const oreFa = (h: number) => new Date(ORA.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ORA);
  stato.erroreAt = null; stato.letturaFallita = false; stato.contatoreConsente = true;
});
afterEach(() => { vi.useRealTimers(); });

describe('il freno di sei ore sui prodotti importati in errore', () => {
  it('un errore di un\'ora fa frena, anche se il contatore di questa copia non sa niente', async () => {
    stato.erroreAt = oreFa(1);
    stato.contatoreConsente = true; // un'altra copia del sito, o nessun Upstash
    expect(await ritentoDopoErroreConsentito('p1')).toBe(false);
  });

  it('un errore di sette ore fa non frena piu\'', async () => {
    stato.erroreAt = oreFa(7);
    expect(await ritentoDopoErroreConsentito('p1')).toBe(true);
  });

  it('senza ora dell\'errore (prodotti andati in errore prima) decide il contatore', async () => {
    expect(await ritentoDopoErroreConsentito('p1')).toBe(true);
    stato.contatoreConsente = false;
    expect(await ritentoDopoErroreConsentito('p1')).toBe(false);
  });

  it('se la colonna non c\'e\' ancora o la lettura fallisce si resta al contatore', async () => {
    stato.letturaFallita = true;
    expect(await ritentoDopoErroreConsentito('p1')).toBe(true);
    stato.contatoreConsente = false;
    expect(await ritentoDopoErroreConsentito('p1')).toBe(false);
  });
});
