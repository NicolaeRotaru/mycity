// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * Il link «apri i reclami» della scheda ordine porta a /admin/disputes senza parametri. La pagina
 * partiva dal filtro «Aperto» e un reclamo gia' «In valutazione» (che la scheda ordine conta come
 * aperto) non si vedeva. Adesso il filtro di partenza mostra i reclami da gestire: aperti e in esame.
 */
type Reclamo = Record<string, unknown> & { status: string };
const stato = vi.hoisted(() => ({ reclami: [] as Reclamo[] }));

function catena(tabella: string): unknown {
  const filtri: Array<(r: Reclamo) => boolean> = [];
  const risposta = () =>
    tabella === 'disputes'
      ? { data: stato.reclami.filter((r) => filtri.every((f) => f(r))), error: null }
      : { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then') return (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok);
      if (k === 'eq') return (c: string, v: unknown) => { if (c === 'status') filtri.push((r) => r.status === v); return p; };
      if (k === 'in') return (c: string, v: unknown[]) => { if (c === 'status') filtri.push((r) => v.includes(r.status)); return p; };
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

function reclamo(id: string, nome: string, status: string): Reclamo {
  return {
    id, order_id: `ord-${id}-0000`, opener_id: `cliente-${id}`, reason: 'other', description: 'x', status,
    resolution_notes: null, refund_cents: null, created_at: '2026-11-20T10:00:00Z',
    opener: { full_name: nome }, against: { store_name: 'Forno', full_name: null },
  };
}

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

async function apri() {
  const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('pagina Reclami raggiunta dalla scheda ordine', () => {
  it('senza scegliere un filtro mostra i reclami aperti e quelli in valutazione, non i chiusi', async () => {
    stato.reclami = [
      reclamo('a', 'Anna Aperto', 'open'),
      reclamo('b', 'Bruno Esame', 'under_review'),
      reclamo('c', 'Carla Chiuso', 'resolved_buyer'),
    ];
    const host = await apri();
    expect(host.textContent).toContain('Anna Aperto');
    expect(host.textContent).toContain('Bruno Esame');
    expect(host.textContent).not.toContain('Carla Chiuso');
  });

  it('il filtro «Aperto» resta solo per gli aperti', async () => {
    stato.reclami = [reclamo('a', 'Anna Aperto', 'open'), reclamo('b', 'Bruno Esame', 'under_review')];
    const host = await apri();
    const bottone = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Aperto');
    expect(bottone).toBeTruthy();
    await act(async () => { bottone!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain('Anna Aperto');
    expect(host.textContent).not.toContain('Bruno Esame');
  });
});
