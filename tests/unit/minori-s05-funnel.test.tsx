// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';
import { speseDistinte } from '@/lib/admin/spese-del-cliente';

/**
 * S05 · schede 643, 266, 261, 296 (funnel) — il funnel dell'admin.
 */

const stato = vi.hoisted(() => ({
  iscritti: [] as unknown[],
  ordini: [] as unknown[],
  guasto: false,
  gte: [] as unknown[],
}));
function catena(tabella: string): unknown {
  const risposta = () => {
    if (stato.guasto) return { data: null, error: { message: 'giù' } };
    return { data: tabella === 'profiles' ? stato.iscritti : stato.ordini, error: null };
  };
  let primaVolta = true;
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then') {
        return (ok: (r: unknown) => unknown) => {
          // leggiTutteLeRighe chiede finestre finché ne arriva una corta: la seconda è vuota.
          const r = primaVolta ? risposta() : { data: [], error: null };
          primaVolta = false;
          return Promise.resolve(r).then(ok);
        };
      }
      if (k === 'gte') return (_c: string, v: unknown) => { if (tabella === 'profiles') stato.gte.push(v); return p; };
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t) } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.(); chiudi = null; vi.useRealTimers();
  stato.iscritti = []; stato.ordini = []; stato.guasto = false; stato.gte.length = 0;
});

async function apri() {
  const mod = (await import('@/app/admin/funnel/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('spese, non righe', () => {
  it('643: un carrello da due negozi è una spesa sola (stessa sessione, o contanti a pochi istanti)', () => {
    expect(speseDistinte([
      { created_at: '2026-11-02T10:00:00Z', stripe_session_id: 'cs_1' },
      { created_at: '2026-11-02T10:00:03Z', stripe_session_id: 'cs_1' },
    ])).toHaveLength(1);
    expect(speseDistinte([
      { created_at: '2026-11-02T10:00:00.100Z', stripe_session_id: null },
      { created_at: '2026-11-02T10:00:00.400Z', stripe_session_id: null },
    ])).toHaveLength(1);
    expect(speseDistinte([
      { created_at: '2026-11-02T10:00:00Z', stripe_session_id: null },
      { created_at: '2026-11-09T10:00:00Z', stripe_session_id: null },
    ])).toHaveLength(2);
  });

  it('643/266: chi ha pagato una volta da due negozi non è «Ricorrente» e l’allarme usa «a rischio» vero', async () => {
    const vecchio = new Date(Date.now() - 80 * 86_400_000).toISOString();
    const dopo = new Date(new Date(vecchio).getTime() + 500).toISOString();
    stato.iscritti = [{ id: 'u1', created_at: new Date(Date.now() - 85 * 86_400_000).toISOString() }];
    stato.ordini = [
      { user_id: 'u1', created_at: vecchio, delivery_status: 'DELIVERED', payment_status: 'PAID', stripe_session_id: null },
      { user_id: 'u1', created_at: dopo, delivery_status: 'DELIVERED', payment_status: 'PAID', stripe_session_id: null },
    ];
    const host = await apri();
    const chip = (nome: string) => [...host.querySelectorAll('span')].find((s) => s.textContent?.startsWith(nome))?.textContent ?? '';
    expect(chip('Ricorrenti')).toMatch(/0/);
    expect(host.textContent).toContain('Alert churn · 1 buyer a rischio');
    // Codici spenti in cassa: niente consiglio del coupon.
    expect(host.textContent).not.toContain('coupon di richiamo');
  });
});

describe('funnel: date e guasti', () => {
  it('261: il 31/12 la lettura parte dal 1° settembre, come la prima coorte', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    await apri();
    const da = String(stato.gte[0]);
    // 1/9/2026 a mezzanotte di Piacenza = 31/8 22:00 UTC.
    expect(da).toBe('2026-08-31T22:00:00.000Z');
  });

  it('296: lettura caduta → avviso con «Riprova», non lo scheletro per sempre', async () => {
    stato.guasto = true;
    const host = await apri();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
