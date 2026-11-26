// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna, aspetta, fake } from './aiuti/cabina-admin';

/**
 * Il link «apri i reclami» della scheda ordine porta a /admin/disputes, che si apre sul filtro
 * «Aperto»: quel filtro leggeva solo status = 'open' e un reclamo «in valutazione» non compariva.
 * Ora il filtro d'apertura legge anche gli 'under_review'; gli altri filtri restano esatti.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

async function apri() {
  const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('reclami: il filtro d\'apertura mostra anche quelli in valutazione', () => {
  it('alla prima apertura la lettura dei reclami include open e under_review', async () => {
    fake.azzera();
    await apri();
    const lettura = fake.domande.find((d) => d.tabella === 'disputes' && d.op === 'select');
    expect(lettura).toBeDefined();
    expect(lettura?.filtri.status).toEqual(['open', 'under_review']);
  });

  it('il filtro «In valutazione» resta esatto e «Tutti» non filtra', async () => {
    const host = await apri();
    const premi = async (testo: string) => {
      fake.domande.length = 0;
      const b = [...host.querySelectorAll('button')].find((x) => x.textContent?.includes(testo));
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await aspetta();
      return fake.domande.find((d) => d.tabella === 'disputes' && d.op === 'select');
    };
    expect((await premi('In valutazione'))?.filtri.status).toBe('under_review');
    expect((await premi('Tutti'))?.filtri.status).toBeUndefined();
  });
  it('il riquadro «Reclami da gestire» conta open e under_review insieme', async () => {
    const riga = (id: string, status: string, opener: string) => ({
      id, order_id: `${id}-ordine-00000000`, opener_id: opener, reason: 'other', description: 'x', status,
      resolution_notes: null, refund_cents: null, created_at: '2026-11-01T10:00:00Z',
      opener: { full_name: 'Cliente' }, against: { store_name: `Negozio ${id}`, full_name: null },
    });
    fake.rispondi = (q) => ({
      data: q.tabella === 'disputes' && q.op === 'select'
        ? [riga('a1', 'open', 'u1'), riga('a2', 'under_review', 'u2'), riga('a3', 'under_review', 'u3')]
        : [],
      error: null,
    });
    const host = await apri();
    const testo = host.textContent ?? '';
    expect(testo).toContain('Reclami da gestire');
    expect(testo).toContain('3 reclami da decidere');
  });
});
