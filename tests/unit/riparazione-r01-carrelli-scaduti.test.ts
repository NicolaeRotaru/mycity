import { describe, it, expect, vi } from 'vitest';

/**
 * R01-016 — DUECENTO CARRELLI PAGATI A META' FERMAVANO PER SEMPRE LA PULIZIA.
 *
 * I carrelli pagati a meta' (ordini gia' nati, carrello ancora PENDING) non si toccano, quindi
 * tornano fra i candidati a ogni giro. Il giro leggeva al massimo duecento candidati: con
 * duecento casi cosi' davanti, i carrelli scaduti veri non arrivavano mai a scadere e la loro
 * merce restava bloccata.
 *
 * Il database finto qui sotto si comporta come quello vero per quello che il giro chiede:
 * filtra per stato e scadenza, ordina, e `limit` taglia davvero.
 */
type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({ carrelli: [] as Riga[], ordini: [] as Riga[], rpc: [] as string[] }));

function query(tabella: string) {
  let righe: Riga[] = tabella === 'pending_checkouts' ? db.carrelli : tabella === 'orders' ? db.ordini : [];
  let aggiorna: Riga | null = null;
  const q: Record<string, unknown> = {
    select: () => q,
    update: (v: Riga) => { aggiorna = v; return q; },
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
    eq: (c: string, v: unknown) => { righe = righe.filter((r) => r[c] === v); return q; },
    in: (c: string, v: unknown[]) => { righe = righe.filter((r) => v.includes(r[c])); return q; },
    lt: (c: string, v: string) => { righe = righe.filter((r) => String(r[c]) < v); return q; },
    gte: () => q,
    order: (c: string, o?: { ascending?: boolean }) => {
      righe = [...righe].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending === false ? -1 : 1));
      return q;
    },
    limit: (n: number) => { righe = righe.slice(0, n); return q; },
    then: (ok: (v: unknown) => unknown) => {
      if (aggiorna) for (const r of righe) Object.assign(r, aggiorna);
      return ok({ data: righe, error: null });
    },
  };
  return q;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/cron/fermo-dei-lavori', () => ({ chiamataDelCalendarioFerma: () => false, rispostaDelFermo: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => (t === 'profiles' ? { select: () => ({ eq: async () => ({ data: [{ id: 'a1' }], error: null }) }) } : query(t)),
    rpc: (nome: string) => { db.rpc.push(nome); return Promise.resolve({ data: null, error: null }); },
  }),
}));

import { POST } from '@/app/api/cron/expire-checkouts/route';

const ora = Date.UTC(2026, 10, 12, 12, 0, 0);
const isoFa = (minuti: number) => new Date(ora - minuti * 60_000).toISOString();

describe('R01-016 · i carrelli pagati a meta\' non bloccano la pulizia degli altri', () => {
  it('con 200 carrelli pagati a meta\' davanti, il carrello scaduto vero dietro scade lo stesso', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ora);
    db.carrelli = [
      ...Array.from({ length: 200 }, (_, i) => ({
        id: `meta-${i}`, status: 'PENDING', expires_at: isoFa(10 + i), stripe_session_id: `cs_meta_${i}`,
        coupon_code: null, groups: [{ items: [{ productId: `pm${i}`, quantity: 1 }] }],
      })),
      { id: 'vero', status: 'PENDING', expires_at: isoFa(5000), stripe_session_id: 'cs_vero', coupon_code: null,
        groups: [{ items: [{ productId: 'p-vero', quantity: 1 }] }] },
    ];
    db.ordini = Array.from({ length: 200 }, (_, i) => ({ id: `o${i}`, stripe_session_id: `cs_meta_${i}` }));
    await (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/cron/expire-checkouts', { method: 'POST' }));
    vi.useRealTimers();
    expect(db.carrelli.find((c) => c.id === 'vero')!.status).toBe('EXPIRED');
    expect(db.carrelli.filter((c) => c.status === 'EXPIRED')).toHaveLength(1);
    expect(db.rpc).toContain('restore_stock');
  });
});
