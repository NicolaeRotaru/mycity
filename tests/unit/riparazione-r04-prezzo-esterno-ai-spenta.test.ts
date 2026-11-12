import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-011 — Con l'AI spenta, chi guardava un prodotto importato da un altro
 * sito lo faceva segnare «aggiornato adesso» anche se nessun dato era
 * arrivato. Adesso con l'interruttore spento la rotta non scrive niente, e un
 * aggiornamento fallito non tocca external_synced_at.
 */

const stato = { accesa: false };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return { ...vero, get AI_NEGOZI_ACCESA() { return stato.accesa; } };
});

const RIGA = {
  external_source_url: 'https://www.amazon.it/dp/B000000000',
  external_marketplace: 'amazon',
  external_data: { price: 10 },
  external_synced_at: '2026-11-01T10:00:00Z',
  external_sync_status: 'idle',
};
const scritture: Record<string, unknown>[] = [];
const client = () => ({
  from: () => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: RIGA, error: null }) }) }),
    update: (v: Record<string, unknown>) => {
      scritture.push(v);
      const catena = {
        eq: () => catena,
        neq: () => catena,
        select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }),
        then: (r: (x: unknown) => void) => r({ error: null }),
      };
      return catena;
    },
  }),
});
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => client(),
  getServerSupabase: async () => client(),
}));
const fetchMock = vi.fn();
vi.mock('@/lib/products/externalSync', () => ({
  isStale: () => true,
  fetchExternalSnapshot: (...a: unknown[]) => fetchMock(...a),
}));

import { GET } from '@/app/api/products/[id]/external-refresh/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const ID = '11111111-1111-4111-8111-111111111111';
const chiedi = () =>
  GET(new Request(`http://localhost/api/products/${ID}/external-refresh`) as never, { params: Promise.resolve({ id: ID }) });

describe('prezzo esterno con l\'AI spenta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scritture.length = 0;
    __resetRateLimitBuckets();
  });

  it('interruttore spento: dati salvati restituiti, nessuna scrittura, nessuna chiamata', async () => {
    stato.accesa = false;
    const res = await chiedi();
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(scritture).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aggiornamento fallito: stato «error» ma external_synced_at non diventa «adesso»', async () => {
    stato.accesa = true;
    fetchMock.mockRejectedValue(new Error('servizio AI spento'));
    await chiedi();
    await new Promise((r) => setTimeout(r, 10));
    const errore = scritture.find((w) => w.external_sync_status === 'error');
    expect(errore).toBeDefined();
    expect(errore).not.toHaveProperty('external_synced_at');
  });
});
