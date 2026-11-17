// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';

/**
 * R30-025 — Nel pannello dei coupon un codice scaduto o esaurito non risulta più «Attivo».
 *
 * La pagina guardava solo `active`: un codice scaduto ieri e uno con tutti gli usi consumati
 * si leggevano «Attivo (spento in cassa)», mentre la cassa li rifiuta (check_coupon guarda la
 * scadenza e uses_count >= max_uses). Qui il giorno lo sceglie la prova: 17 novembre 2026.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const OGGI = new Date('2026-11-17T10:00:00+01:00');

const base = {
  type: 'PERCENT', value: 10, min_subtotal: 0, first_order_only: false, description: null,
  starts_at: null, created_at: '2026-11-01T00:00:00Z', active: true,
};
const SCADUTO = { ...base, id: 'c1', code: 'ESTATE', max_uses: null, uses_count: 0, expires_at: '2026-11-16T22:59:00Z' };
const ESAURITO = { ...base, id: 'c2', code: 'PRIMI100', max_uses: 100, uses_count: 100, expires_at: null };
const BUONO = { ...base, id: 'c3', code: 'NATALE', max_uses: 100, uses_count: 3, expires_at: '2026-12-31T22:59:00Z' };
const SPENTO = { ...base, id: 'c4', code: 'VECCHIO', max_uses: null, uses_count: 0, expires_at: null, active: false };

let chiudi: (() => void) | null = null;
beforeEach(() => {
  // Solo l'orologio di Date: i timer veri restano, la pagina deve poter finire di disegnare.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(OGGI);
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  fake.azzera();
  vi.useRealTimers();
});

async function apri(coupon: Record<string, unknown>) {
  fake.rispondi = () => ({ data: [coupon], error: null });
  const mod = (await import('@/app/admin/coupons/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

/** Il testo del pulsante dello stato (quello che si accende e si spegne). */
function badge(host: HTMLElement): string {
  const b = [...host.querySelectorAll('button')].find((x) => /coupon/.test(x.getAttribute('aria-label') ?? ''));
  return b?.textContent ?? '(nessun pulsante dello stato)';
}

describe('R30-025 — lo stato del coupon segue la cassa', () => {
  it('scaduto ieri sera: «Scaduto», con la data, non «Attivo»', async () => {
    const host = await apri(SCADUTO);
    expect(badge(host)).toBe('Scaduto');
    expect(host.textContent).toContain('Scaduto il 16 novembre 2026');
  });

  it('tutti gli usi consumati: «Esaurito», non «Attivo»', async () => {
    const host = await apri(ESAURITO);
    expect(badge(host)).toBe('Esaurito');
  });

  it('valido e con usi rimasti: «Attivo» come prima, e dice fino a quando', async () => {
    const host = await apri(BUONO);
    expect(badge(host)).toMatch(/^Attivo/);
    expect(host.textContent).toContain('Scade il 31 dicembre 2026');
  });

  it('spento a mano: «Disattivato», anche se non è scaduto', async () => {
    const host = await apri(SPENTO);
    expect(badge(host)).toBe('Disattivato');
  });
});
