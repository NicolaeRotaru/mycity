import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { leggiCruscottoOggi } from '@/lib/queries/cruscotto-oggi';

// R09-012 — Il riquadro dei negozi «in attesa» contava role='seller' e is_approved=false, cioè anche
// i sospesi: 16 in attesa + 9 sospesi = 25. Deve contare solo approval_status = 'pending'.
type Riga = Record<string, unknown>;

function fintoDatabase(tabelle: Record<string, Riga[]>): SupabaseClient {
  const from = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let conteggio = false;
    const righe = () => (tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
    const b: Record<string, unknown> = {
      select: (_c: string, op?: { count?: string }) => { conteggio = op?.count === 'exact'; return b; },
      eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return b; },
      in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
      is: (k: string, v: unknown) => { filtri.push((r) => (r[k] ?? null) === v); return b; },
      gte: (k: string, v: string) => { filtri.push((r) => String(r[k] ?? '') >= v); return b; },
      lt: (k: string, v: string) => { filtri.push((r) => String(r[k] ?? '') < v); return b; },
      order: () => b,
      limit: () => b,
      range: () => b,
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(conteggio ? { data: null, count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

describe('R09-012 · i negozi in attesa non comprendono i sospesi', () => {
  it('16 in attesa e 9 sospesi: il riquadro dice 16', async () => {
    const profiles: Riga[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, role: 'seller', is_approved: false, approval_status: 'pending', created_at: '2026-01-01T00:00:00Z' })),
      ...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, role: 'seller', is_approved: false, approval_status: 'suspended', created_at: '2026-01-01T00:00:00Z' })),
      { id: 'ok', role: 'seller', is_approved: true, approval_status: 'approved', created_at: '2026-01-01T00:00:00Z' },
    ];
    const c = await leggiCruscottoOggi(fintoDatabase({ profiles, orders: [], rider_sos_events: [], disputes: [] }), new Date('2026-11-12T10:00:00Z'));
    expect(c.sellersPendingCount).toBe(16);
  });

  it('l’etichetta del riquadro è in italiano', () => {
    const s = readFileSync('app/admin/today/page.tsx', 'utf8');
    expect(s).toContain('label="Negozi in attesa"');
    expect(s).not.toContain('Seller pending');
  });
});
