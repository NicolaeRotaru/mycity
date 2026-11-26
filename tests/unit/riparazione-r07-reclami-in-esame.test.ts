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
});
