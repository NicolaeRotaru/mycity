import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — resi.
 *  · 48: se il database non risponde, chi decide un reso non legge «ordine non
 *    trovato» o «non autorizzato»: legge un guasto (503 nelle rotte).
 */
const db = vi.hoisted(() => ({
  ordine: { data: null as unknown, error: null as unknown },
  profilo: { data: null as unknown, error: null as unknown },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ single: async () => (t === 'orders' ? db.ordine : db.profilo) }) }),
    }),
  }),
}));

import { chiComandaIlReso } from '@/app/api/returns/chi-comanda-il-reso';

beforeEach(() => {
  db.ordine = { data: { seller_id: 'negozio' }, error: null };
  db.profilo = { data: { role: 'buyer' }, error: null };
});

describe('48 — chi comanda il reso distingue il guasto dall\'assenza', () => {
  it('lettura dell\'ordine caduta → guasto, non ordine-mancante', async () => {
    db.ordine = { data: null, error: { code: '08006', message: 'connessione persa' } };
    expect(await chiComandaIlReso('o1', 'u1')).toEqual({ autorizzato: false, motivo: 'guasto' });
  });
  it('ordine che davvero non c\'e\' (PGRST116) → ordine-mancante', async () => {
    db.ordine = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    expect(await chiComandaIlReso('o1', 'u1')).toEqual({ autorizzato: false, motivo: 'ordine-mancante' });
  });
  it('lettura del ruolo caduta → guasto, non «non tuo»', async () => {
    db.profilo = { data: null, error: { code: '57014', message: 'timeout' } };
    expect(await chiComandaIlReso('o1', 'admin-1')).toEqual({ autorizzato: false, motivo: 'guasto' });
  });
  it('il negozio dell\'ordine resta autorizzato', async () => {
    expect(await chiComandaIlReso('o1', 'negozio')).toEqual({ autorizzato: true, sellerOrdine: 'negozio' });
  });
});
