import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R71 — CHI DEVE FARE IL BONIFICO LO TROVA, CON L'IBAN, E LO SEGNA FATTO.
 *
 * Un rimborso col bonifico non esce da solo: lo manda a mano chi amministra.
 * La rotta VERA della lista: legge i resi rimborsati col bonifico, mostra la
 * cifra del bonifico e l'IBAN (che nessun browser legge direttamente), e segna
 * un bonifico come fatto una volta sola. Senza la migrazione 162 la lista c'e'
 * lo stesso, e «fatto» si rifiuta dicendo perche'.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request) => handler({ user: { id: 'nicola' }, req, params: {} }),
}));

import { GET, POST } from '@/app/api/admin/rimborsi-da-bonificare/route';

const R1 = '22222222-2222-4222-8222-222222222222';

function apri(colonneMancanti: string[] = []) {
  finto.db = creaFintoDatabase(
    {
      returns: [
        { id: R1, order_id: 'o1', status: 'REFUNDED', refund_amount_cents: 5000, refunded_at: '2026-10-12T10:00:00Z',
          refund_id: `bonifico:return_${R1}`, refund_iban: 'IT60X0542811101000000123456', refund_bonifico_cents: 3000,
          refund_bonifico_fatto_at: null },
        { id: 'r2', order_id: 'o2', status: 'REFUNDED', refund_amount_cents: 1000, refunded_at: '2026-10-12T11:00:00Z',
          refund_id: 'wallet:return_r2', refund_iban: null, refund_bonifico_cents: null, refund_bonifico_fatto_at: null },
      ],
    },
    { colonneMancanti },
  );
}

const leggi = async () => {
  const res = await GET(new Request('http://localhost/api/admin/rimborsi-da-bonificare') as never, undefined as never);
  return { status: res.status, corpo: await res.json() };
};
const segna = async (resoId: string) => {
  const res = await POST(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resoId }),
    }) as never,
    undefined as never,
  );
  return { status: res.status, corpo: await res.json() };
};

beforeEach(() => apri());

describe('la lista dei bonifici da fare', () => {
  it('mostra solo i bonifici, con la cifra del bonifico e l IBAN', async () => {
    const { status, corpo } = await leggi();

    expect(status).toBe(200);
    expect(corpo.voci).toHaveLength(1);
    expect(corpo.voci[0]).toMatchObject({ resoId: R1, importoCents: 3000, iban: 'IT60 X054 2811 1010 0000 0123 456', daFare: true });
  });

  it('un bonifico si segna fatto una volta sola', async () => {
    expect((await segna(R1)).status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_bonifico_fatto_at).toBeTruthy();
    expect((await segna(R1)).status).toBe(409);
    expect((await leggi()).corpo.voci[0].daFare).toBe(false);
  });

  it('senza la migrazione 162: la lista c e, senza IBAN, e «fatto» dice perche non si puo', async () => {
    apri(['refund_method', 'refund_iban', 'refund_bonifico_cents', 'refund_bonifico_fatto_at']);

    const { status, corpo } = await leggi();
    expect(status).toBe(200);
    expect(corpo.migrazione162).toBe(false);
    expect(corpo.voci[0]).toMatchObject({ resoId: R1, iban: null, importoCents: 5000 });

    const fatto = await segna(R1);
    expect(fatto.status).toBe(409);
    expect(fatto.corpo.error.message).toContain('migrazione 162');
  });
});
