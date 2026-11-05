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

import { rigaResaCents, interoDelRecesso } from '@/lib/rimborsi/regole-del-rimborso';

describe('2565 — l intero del recesso su una riga è quello pagato, col codice tolto in proporzione', () => {
  const righe = [
    { id: 'a', unit_price: 20, quantity: 1 },
    { id: 'b', unit_price: 10, quantity: 2 },
  ];
  it('ordine da 40 € con 4 € di codice: la riga da 20 € vale 18 €', () => {
    expect(rigaResaCents(righe, 'a', 400)).toBe(1800);
    expect(interoDelRecesso(3600, rigaResaCents(righe, 'a', 400))).toBe(1800);
  });
  it('senza codice resta prezzo per quantità', () => {
    expect(rigaResaCents(righe, 'b')).toBe(2000);
  });
  it('le due rotte passano lo sconto dell ordine', async () => {
    const { readFileSync } = await import('node:fs');
    for (const p of ['app/api/returns/[id]/decide/route.ts', 'app/api/returns/[id]/avanza/route.ts']) {
      const s = readFileSync(p, 'utf8');
      expect(s).toContain('discount_amount');
      expect(s).toMatch(/rigaResaCents\(righe, [^)]+\)?, Math\.round\(Number\(\(ordine/);
    }
  });
});
