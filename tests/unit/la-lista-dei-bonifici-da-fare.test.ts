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
const D1 = '33333333-3333-4333-8333-333333333333';

function apri(colonneMancanti: string[] = [], tabelleMancanti: string[] = []) {
  finto.db = creaFintoDatabase(
    {
      // Collaudo del 15/10 — il bonifico di un reclamo chiuso a favore del cliente.
      bonifici_dei_reclami: [
        { dispute_id: D1, order_id: 'o3', importo_cents: 1800, registrato_at: '2026-10-11T09:00:00Z', fatto_at: null },
      ],
      // Terzo giro del riesame — la conferma che scrive `refundOrder`: il segno del bonifico
      // nell'elenco dei rimborsi dell'ordine. Senza, il bonifico va fra quelli da controllare.
      orders: [{ id: 'o1', stripe_refund_id: `bonifico:3000:return_${R1}` }],
      returns: [
        { id: R1, order_id: 'o1', status: 'REFUNDED', refund_amount_cents: 5000, refunded_at: '2026-10-12T10:00:00Z',
          refund_id: `bonifico:3000:return_${R1}`, refund_iban: 'IT60X0542811101000000123456', refund_bonifico_cents: 3000,
          refund_bonifico_fatto_at: null },
        { id: 'r2', order_id: 'o2', status: 'REFUNDED', refund_amount_cents: 1000, refunded_at: '2026-10-12T11:00:00Z',
          refund_id: 'wallet:return_r2', refund_iban: null, refund_bonifico_cents: null, refund_bonifico_fatto_at: null },
      ],
    },
    { colonneMancanti, tabelleMancanti },
  );
}

const leggi = async () => {
  const res = await GET(new Request('http://localhost/api/admin/rimborsi-da-bonificare') as never, undefined as never);
  return { status: res.status, corpo: await res.json() };
};
const segna = async (resoId: string) => segnaCorpo({ resoId });
const segnaCorpo = async (corpo: Record<string, string>) => {
  const res = await POST(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
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
    const reso = corpo.voci.find((v: { tipo: string }) => v.tipo === 'reso');
    expect(corpo.voci.filter((v: { tipo: string }) => v.tipo === 'reso')).toHaveLength(1);
    expect(reso).toMatchObject({ id: R1, importoCents: 3000, iban: 'IT60 X054 2811 1010 0000 0123 456', daFare: true });
  });

  it('ci sono anche i bonifici dei reclami: prima vivevano solo nella campanella', async () => {
    const { corpo } = await leggi();

    const reclamo = corpo.voci.find((v: { tipo: string }) => v.tipo === 'reclamo');
    expect(reclamo, 'il bonifico promesso dopo un reclamo non e in nessuna lista').toMatchObject({
      id: D1, ordineId: 'o3', importoCents: 1800, iban: null, daFare: true,
    });
  });

  it('il bonifico di un reclamo si segna fatto una volta sola', async () => {
    expect((await segnaCorpo({ reclamoId: D1 })).status).toBe(200);
    expect(finto.db.tabelle.bonifici_dei_reclami[0].fatto_at).toBeTruthy();
    expect((await segnaCorpo({ reclamoId: D1 })).status).toBe(409);
    const { corpo } = await leggi();
    expect(corpo.voci.find((v: { tipo: string }) => v.tipo === 'reclamo').daFare).toBe(false);
    // Il reso non e' stato toccato.
    expect(finto.db.tabelle.returns[0].refund_bonifico_fatto_at).toBeNull();
  });

  it('o il reso o il reclamo: tutti e due, o nessuno, non si accetta', async () => {
    expect((await segnaCorpo({})).status).toBe(400);
    expect((await segnaCorpo({ resoId: R1, reclamoId: D1 })).status).toBe(400);
  });

  it('un bonifico si segna fatto una volta sola', async () => {
    expect((await segna(R1)).status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_bonifico_fatto_at).toBeTruthy();
    expect((await segna(R1)).status).toBe(409);
    expect((await leggi()).corpo.voci.find((v: { id: string }) => v.id === R1).daFare).toBe(false);
  });

  it('senza la migrazione 162: la lista c e, senza IBAN, e «fatto» dice perche non si puo', async () => {
    apri(['refund_method', 'refund_iban', 'refund_bonifico_cents', 'refund_bonifico_fatto_at'], ['bonifici_dei_reclami']);

    const { status, corpo } = await leggi();
    expect(status).toBe(200);
    expect(corpo.migrazione162).toBe(false);
    expect(corpo.voci).toHaveLength(1);
    // Collaudo del 15/10, secondo giro: qui la prova fissava 5000, cioe' l'intero
    // rimborso su una riga il cui bonifico era 3000 (20 € erano tornati come
    // credito). La cifra giusta c'e' anche senza la 162: sta nel segno del rimborso.
    expect(corpo.voci[0]).toMatchObject({ tipo: 'reso', id: R1, iban: null, importoCents: 3000 });

    const fatto = await segna(R1);
    expect(fatto.status).toBe(409);
    expect(fatto.corpo.error.message).toContain('migrazione 162');

    const fattoReclamo = await segnaCorpo({ reclamoId: D1 });
    expect(fattoReclamo.status).toBe(409);
    expect(fattoReclamo.corpo.error.message).toContain('migrazione 162');
  });
});
