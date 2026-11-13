import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R14-010 — il giro che annulla (app/api/cron/expire-stale-orders/route.ts) non si ferma ai
 * primi cento ordini fermi.
 *
 * Il caso: centocinquanta ordini della sera prima per la fascia di oggi pomeriggio, in regola
 * (rinviati), e una veloce delle 6:00 che nessuno ha accettato e che alle 9:00 è scaduta. In
 * ordine di nascita la veloce è la centocinquantunesima: con la lettura ferma a cento restava
 * fuori dal giro, a ogni giro.
 *
 * Il finto database applica davvero eq, lt, gte, order e limit sugli ordini, e l'annullo
 * condizionato (update … eq id … eq NEW) sposta l'ordine su CANCELED.
 */

type Riga = Record<string, unknown>;
let ordini: Riga[] = [];

function lettura() {
  const filtri: Array<(r: Riga) => boolean> = [];
  let ordine: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let modifica: Riga | null = null;
  let ritorna = false;
  const b: Record<string, unknown> = {
    select: () => { if (modifica) ritorna = true; return b; },
    update: (v: Riga) => { modifica = v; return b; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return b; },
    lt: (c: string, v: string) => { filtri.push((r) => r[c] != null && String(r[c]) < v); return b; },
    gte: (c: string, v: string) => { filtri.push((r) => r[c] != null && String(r[c]) >= v); return b; },
    order: (col: string, o?: { ascending?: boolean }) => { ordine = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (v: unknown) => unknown) => {
      let righe = ordini.filter((r) => filtri.every((f) => f(r)));
      if (modifica) {
        for (const r of righe) Object.assign(r, modifica);
        return Promise.resolve({ data: ritorna ? righe.map((r) => ({ id: r.id })) : null, error: null }).then(ok);
      }
      if (ordine) {
        const { col, asc } = ordine;
        righe = [...righe].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limite !== null) righe = righe.slice(0, limite);
      return Promise.resolve({ data: righe.map((r) => ({ ...r })), error: null }).then(ok);
    },
  };
  return b;
}

function vuota() {
  const b: Record<string, unknown> = new Proxy({}, {
    get(_t, k) {
      if (k === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return () => b;
    },
  });
  return b;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 })) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => 'scritto') }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: vi.fn(async () => false) }));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => undefined) }));
vi.mock('@/lib/ordini/annulla', () => ({
  avvisaIlClienteDellAnnullo: vi.fn(async () => undefined),
  avvisaLaCampanellaDelCarrello: vi.fn(async () => undefined),
  ricalcolaLaConsegnaDelGiro: vi.fn(async () => null),
  restituisciIlCodiceDellOrdine: vi.fn(async () => undefined),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => (t === 'orders' ? lettura() : vuota()),
    rpc: async () => ({ data: null, error: null }),
  }),
}));

async function giroCheAnnulla() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return (await res.json()) as { canceled: number; rinviati: number };
}

/** Lunedì 16 novembre 2026, 11:00 a Piacenza (10:00 UTC). */
const ADESSO = new Date('2026-11-16T10:00:00.000Z');
const VELOCE = '99999999-aaaa-4aaa-8aaa-000000000999';

function inRegola(i: number): Riga {
  // Domenica sera fra le 19:00 e le 21:30 (UTC 18:00-20:30) per «Domani · 12:00–15:00»: buoni fino alle 15:00 di oggi.
  const nato = new Date(Date.parse('2026-11-15T18:00:00.000Z') + i * 60_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    user_id: 'cliente', seller_id: 'negozio', payment_method: 'cod', payment_status: 'PENDING',
    total_price: 10, wallet_applied_cents: 0, coupon_code: null,
    delivery_status: 'NEW', created_at: nato, delivery_slot: 'Domani · 12:00–15:00', seller: { store_hours: null },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  ordini = Array.from({ length: 150 }, (_, i) => inRegola(i));
  // La veloce delle 7:00 di Piacenza (6:00 UTC), senza fascia: tre ore per accettarla, scadute alle 9:00 UTC.
  ordini.push({
    ...inRegola(999), id: VELOCE, created_at: '2026-11-16T06:00:00.000Z', delivery_slot: null,
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('R14-010 — il giro che annulla non si ferma ai primi cento ordini fermi', () => {
  it('una veloce scaduta dietro centocinquanta ordini in regola viene annullata', async () => {
    const esito = await giroCheAnnulla();
    expect(ordini.find((o) => o.id === VELOCE)?.delivery_status, 'la veloce scaduta resta fuori dal giro').toBe('CANCELED');
    expect(esito.canceled).toBe(1);
    expect(esito.rinviati).toBe(150);
    // Gli ordini in regola non si toccano.
    expect(ordini.filter((o) => o.delivery_status === 'CANCELED')).toHaveLength(1);
  });

  it('anche con nascite uguali al bordo della pagina nessun ordine si legge due volte', async () => {
    // Tutti i centocinquanta nati nello stesso istante: la pagina dopo riparte da quell'istante.
    for (const o of ordini) if (o.id !== VELOCE) o.created_at = '2026-11-15T18:00:00.000Z';
    const esito = await giroCheAnnulla();
    expect(esito.rinviati).toBe(150);
    expect(ordini.filter((o) => o.delivery_status === 'CANCELED').map((o) => o.id)).toEqual([VELOCE]);
  });

  it('gli annulli restano al massimo cento per giro: gli altri scaduti li prende il giro dopo', async () => {
    ordini = Array.from({ length: 120 }, (_, i) => ({
      ...inRegola(i), delivery_slot: null, created_at: new Date(Date.parse('2026-11-16T05:00:00.000Z') + i * 1_000).toISOString(),
    }));
    expect((await giroCheAnnulla()).canceled).toBe(100);
    expect((await giroCheAnnulla()).canceled).toBe(20);
    expect(ordini.every((o) => o.delivery_status === 'CANCELED')).toBe(true);
  });
});
