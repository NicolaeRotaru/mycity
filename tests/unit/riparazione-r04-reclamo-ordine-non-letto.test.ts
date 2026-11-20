import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-002, correzione) — CHIUDERE UN RECLAMO CON L'ORDINE NON LETTO NON MUOVE SOLDI.
 *
 * La rotta che chiude un reclamo legge l'ordine prima di tutto: serve al tetto R84 (non si rimborsa
 * più di quello che il cliente ha pagato) e a sapere se è una carta (Stripe deve essere configurato).
 * La lettura ignorava l'errore: con il database che non rispondeva `ord` restava vuoto, il tetto e il
 * controllo di Stripe saltavano, e partivano lo stesso la chiusura del reclamo con l'importo scritto
 * a mano, il rimborso, lo stato sull'ordine e gli avvisi. Adesso una lettura caduta (08006) è un 500
 * «riprova» PRIMA di qualunque scrittura, rimborso o notifica. L'ordine che proprio non c'è
 * (PGRST116) resta com'era: il reclamo si chiude.
 */

const DISPUTE_ID = 'dddddddd-0000-4000-8000-000000000001';
const ORDINE_ID = 'oooooooo-0000-4000-8000-000000000001';
const GIU = { code: '08006', message: 'connessione persa' };
const NESSUNA_RIGA = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

const stato = vi.hoisted(() => ({
  letture: {} as Record<string, { data: unknown; error: unknown }>,
  scritture: [] as Array<{ tabella: string; patch: Record<string, unknown> }>,
  rimborsi: [] as unknown[],
  avvisi: [] as unknown[],
  campanelle: [] as unknown[],
  registro: [] as unknown[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: '99999999-9999-4999-8999-999999999999' }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (r: unknown) => {
    stato.registro.push(r);
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ disputes: { list: async () => ({ data: [] }) } }),
}));
vi.mock('@/lib/stripe/payout', async (o) => ({
  ...((await o()) as Record<string, unknown>),
  refundOrder: vi.fn(async (a: unknown) => {
    stato.rimborsi.push(a);
    return { refundId: 're_1', reversedCents: 0, pieno: false };
  }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (...a: unknown[]) => {
    stato.avvisi.push(a);
  }),
}));
vi.mock('@/lib/ordini/campanella', () => ({
  scriviCampanella: vi.fn(async (_c: unknown, riga: unknown) => {
    stato.campanelle.push(riga);
  }),
}));
vi.mock('@/lib/supabase/server', () => {
  const tavolo = (tabella: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'neq', 'or', 'order', 'limit', 'not']) b[m] = () => b;
    b.single = async () => stato.letture[tabella] ?? { data: null, error: null };
    b.maybeSingle = async () => stato.letture[tabella] ?? { data: null, error: null };
    b.update = (patch: Record<string, unknown>) => {
      stato.scritture.push({ tabella, patch });
      return b;
    };
    b.insert = async (patch: Record<string, unknown>) => {
      stato.scritture.push({ tabella, patch });
      return { error: null };
    };
    // Le scritture «rivendicate» (update … select('id')) trovano la riga: il giro va avanti fino ai soldi.
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [{ id: DISPUTE_ID }], error: null });
    return b;
  };
  const admin = { from: tavolo, rpc: async () => ({ data: null, error: null }) };
  return { getAdminSupabase: () => admin, getServerSupabase: async () => admin };
});

import { POST as CHIUDI_RECLAMO } from '@/app/api/admin/disputes/[id]/resolve/route';

function chiudi(corpo: unknown) {
  const req = new Request(`http://localhost/api/admin/disputes/${DISPUTE_ID}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return (CHIUDI_RECLAMO as unknown as (r: Request, c: unknown) => Promise<Response>)(req, {
    params: Promise.resolve({ id: DISPUTE_ID }),
  });
}

const RECLAMO_APERTO = {
  data: {
    id: DISPUTE_ID,
    status: 'open',
    order_id: ORDINE_ID,
    opener_id: 'cliente-1',
    against_id: 'negozio-1',
    refund_cents: null,
  },
  error: null,
};

beforeEach(() => {
  stato.letture = { disputes: RECLAMO_APERTO };
  stato.scritture.length = 0;
  stato.rimborsi.length = 0;
  stato.avvisi.length = 0;
  stato.campanelle.length = 0;
  stato.registro.length = 0;
});

describe('R04-002 · chiudere un reclamo con la lettura dell’ordine caduta', () => {
  it('a favore del cliente con un rimborso enorme: 500 «riprova», nessuna scrittura, nessun rimborso, nessun avviso', async () => {
    stato.letture.orders = { data: null, error: GIU };
    const res = await chiudi({
      status: 'resolved_buyer',
      notes: 'Merce mai arrivata, rimborso al cliente.',
      refundCents: 9_999_999,
    });
    const corpo = JSON.stringify(await res.json());
    expect(res.status, `con l'ordine non letto la chiusura risponde ${res.status} ${corpo}`).toBe(500);
    expect(corpo).toMatch(/riprova/);
    expect(
      stato.scritture.filter((s) => s.tabella === 'disputes'),
      'il reclamo si è chiuso (con refund_cents) senza aver letto l’ordine',
    ).toEqual([]);
    expect(stato.scritture.filter((s) => s.tabella === 'orders'), 'l’ordine è stato toccato senza essere letto').toEqual([]);
    expect(stato.rimborsi, 'il rimborso è partito senza il tetto R84').toEqual([]);
    expect(stato.avvisi, 'avvisi agli amministratori partiti').toEqual([]);
    expect(stato.campanelle, 'campanelle a cliente o negozio partite').toEqual([]);
    expect(stato.registro).toEqual([]);
  });

  it('respinto: la lettura caduta dell’ordine dà 500 anche senza soldi, e niente si scrive', async () => {
    stato.letture.orders = { data: null, error: GIU };
    const res = await chiudi({ status: 'rejected', notes: 'Reclamo senza fondamento, chiuso.' });
    expect(res.status).toBe(500);
    expect(stato.scritture).toEqual([]);
    expect(stato.campanelle).toEqual([]);
  });

  it('l’ordine proprio non c’è (PGRST116): resta come prima, il reclamo si chiude', async () => {
    stato.letture.orders = { data: null, error: NESSUNA_RIGA };
    const res = await chiudi({ status: 'rejected', notes: 'Reclamo senza fondamento, chiuso.' });
    expect(res.status).toBe(200);
    expect(stato.scritture.some((s) => s.tabella === 'disputes')).toBe(true);
  });
});
