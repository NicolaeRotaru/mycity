// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

// R09-019 — Nella pagina dei traguardi il livello compariva in inglese («GOLD», il codice del
// database) e una lettura caduta diceva «0 / 0 sbloccati · 0% completato».
const stato = vi.hoisted(() => ({ guasto: false }));
const BADGE = { id: 'b1', title: 'Primo ordine', description: 'Fai il primo ordine', icon: '🥇', points_reward: 10, tier: 'gold', target_role: 'buyer', sort_order: 1 };
function catena(tabella: string): unknown {
  const risposta = () => (stato.guasto
    ? { data: null, error: { message: 'giù' } }
    : { data: tabella === 'achievements' ? [BADGE] : [{ achievement_id: 'b1' }], error: null });
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: (t: string) => catena(t), auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; stato.guasto = false; });

async function apri() {
  const mod = (await import('@/app/profile/achievements/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  await aspetta(15);
  return r.host;
}

describe('R09-019 · i traguardi in italiano, e una lettura caduta non è «0 su 0»', () => {
  it('il livello si legge «Oro», non «gold»', async () => {
    const host = await apri();
    expect(host.textContent).toContain('Oro');
    expect(host.textContent).not.toMatch(/\bgold\b/i);
  });

  it('se la lettura cade la pagina lo dice, invece di «0 / 0 sbloccati»', async () => {
    stato.guasto = true;
    const host = await apri();
    expect(host.textContent).toContain('Non riesco a leggere i tuoi badge');
    expect(host.textContent).not.toMatch(/0\s*\/\s*0 sbloccati/);
  });
});
