import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { TETTO_DEI_BONIFICI_DA_FARE, TETTO_DEI_BONIFICI_FATTI } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * 16/10/2026 — UN BONIFICO DA FARE USCIVA DALLA LISTA SE DOPO DI LUI NE ERANO STATI PAGATI 200.
 *
 * La lista dei bonifici di rimborso leggeva gli ultimi 200 resi col bonifico, dal piu' recente,
 * compresi quelli gia' pagati, e solo DOPO il taglio metteva in cima quelli da fare. Il caso: il
 * 1° marzo un cliente aspetta 18 €; dopo di lui 200 rimborsi col bonifico, tutti gia' pagati. La
 * lista restituiva 200 voci e nessuna da fare: il debito da 18 € non lo vedeva piu' nessuno, e
 * l'ordine diceva gia' «rimborsato». Lo stesso per i bonifici dei reclami.
 *
 * Il finto database qui applica davvero i filtri e il tetto; le righe stanno nell'ordine in cui il
 * database le darebbe (dalla piu' recente), cosi' il tetto taglia proprio quella vecchia. I
 * bonifici gia' pagati sono uno in piu' del tetto della lista: se la lettura dei «da fare» torna a
 * prendere anche quelli fatti, il debito vecchio esce dalla finestra qualunque sia il tetto.
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

import { GET } from '@/app/api/admin/rimborsi-da-bonificare/route';

const giorno = (n: number) => new Date(Date.UTC(2026, 2, 1) + n * 3_600_000).toISOString();

/** `n` resi col bonifico gia' pagato, registrati dopo quello dimenticato (il piu' recente prima). */
function resiPagati(n: number): Riga[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `fatto-${i}`, order_id: `o-${i}`, status: 'REFUNDED', refund_amount_cents: 1000,
    refunded_at: giorno(1000 - i), refund_id: `bonifico:1000:return_fatto-${i}`, refund_iban: null,
    refund_bonifico_cents: 1000, refund_bonifico_fatto_at: giorno(1001 - i),
  }));
}

function reclamiPagati(n: number): Riga[] {
  return Array.from({ length: n }, (_, i) => ({
    dispute_id: `rec-fatto-${i}`, order_id: `or-${i}`, importo_cents: 900,
    registrato_at: giorno(1000 - i), fatto_at: giorno(1001 - i), iban: null, intestatario: null,
  }));
}

const dimenticato: Riga = {
  id: 'reso-dimenticato', order_id: 'o-marzo', status: 'REFUNDED', refund_amount_cents: 1800,
  refunded_at: giorno(0), refund_id: 'bonifico:1800:return_reso-dimenticato',
  refund_iban: 'IT60X0542811101000000123456', refund_bonifico_cents: 1800, refund_bonifico_fatto_at: null,
};
const reclamoDimenticato: Riga = {
  dispute_id: 'reclamo-dimenticato', order_id: 'or-marzo', importo_cents: 2500,
  registrato_at: giorno(0), fatto_at: null, iban: null, intestatario: null,
};

/** Piu' bonifici pagati dopo quello dimenticato di quanti la lista ne legga in una volta. */
const PAGATI_DOPO = TETTO_DEI_BONIFICI_DA_FARE + 1;

const leggi = async () => {
  const res = await GET(new Request('http://localhost/api/admin/rimborsi-da-bonificare') as never, undefined as never);
  return { status: res.status, corpo: await res.json() };
};

beforeEach(() => {
  finto.db = creaFintoDatabase({
    returns: [...resiPagati(PAGATI_DOPO), dimenticato],
    bonifici_dei_reclami: [...reclamiPagati(PAGATI_DOPO), reclamoDimenticato],
  });
});

describe('i bonifici da fare non escono dalla lista', () => {
  it('dopo piu bonifici pagati del tetto della lista, il reso da 18 € e il reclamo da 25 € ci sono ancora', async () => {
    const { status, corpo } = await leggi();
    expect(status).toBe(200);
    const daFare = (corpo.voci as Array<{ id: string; daFare: boolean }>).filter((v) => v.daFare).map((v) => v.id);
    expect(daFare, 'il debito vecchio e sparito dietro a quelli gia pagati').toEqual(
      expect.arrayContaining(['reso-dimenticato', 'reclamo-dimenticato']),
    );
    expect(corpo.tagliata).toBe(false);
  });

  it('dei bonifici gia fatti resta solo lo storico recente', async () => {
    const { corpo } = await leggi();
    const fatti = (corpo.voci as Array<{ tipo: string; daFare: boolean }>).filter((v) => !v.daFare);
    expect(fatti.filter((v) => v.tipo === 'reso')).toHaveLength(TETTO_DEI_BONIFICI_FATTI);
    expect(fatti.filter((v) => v.tipo === 'reclamo')).toHaveLength(TETTO_DEI_BONIFICI_FATTI);
    // I da fare vengono sempre prima.
    expect((corpo.voci as Array<{ daFare: boolean }>).slice(0, 2).every((v) => v.daFare)).toBe(true);
  });

  it('se i bonifici da fare sono piu del tetto, la pagina lo sa', async () => {
    finto.db.tabelle.returns.push(
      ...Array.from({ length: TETTO_DEI_BONIFICI_DA_FARE }, (_, i) => ({
        ...dimenticato, id: `da-fare-${i}`, refund_id: `bonifico:1800:return_da-fare-${i}`,
      })),
    );
    const { corpo } = await leggi();
    expect(corpo.tagliata, 'la lista e tagliata e nessuno lo dice').toBe(true);
  });

  it('senza la migrazione 162 i bonifici si leggono lo stesso, tutti come da fare', async () => {
    finto.db = creaFintoDatabase(
      { returns: [...resiPagati(3), dimenticato] },
      {
        colonneMancanti: ['refund_method', 'refund_iban', 'refund_bonifico_cents', 'refund_bonifico_fatto_at', 'refund_intestatario'],
        tabelleMancanti: ['bonifici_dei_reclami'],
      },
    );
    const { status, corpo } = await leggi();
    expect(status).toBe(200);
    expect(corpo.migrazione162).toBe(false);
    expect(corpo.voci).toHaveLength(4);
  });
});
