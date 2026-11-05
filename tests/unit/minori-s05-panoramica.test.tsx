// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

/**
 * S05 · schede 646 e 271 — la Panoramica dell'admin.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const KPI = { ordini_totali: 3, ordini_per_stato: { READY: 1, ASSIGNED: 1, OUT_FOR_DELIVERY: 1 }, incassato_cents: 0 };

async function apri(pagamentiGiu: boolean) {
  fake.rispondi = (q: Domanda) => {
    if (q.op === 'rpc' && q.tabella === 'admin_kpi') return { data: KPI, error: null };
    if (q.tabella === 'payment_attempts') return pagamentiGiu ? { data: null, error: { message: 'giù' } } : { data: [], error: null };
    return { data: [], error: null };
  };
  const mod = (await import('@/app/admin/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}
const riquadro = (host: HTMLElement, etichetta: string) =>
  [...host.querySelectorAll('div.rounded-xl')].find((d) => [...d.querySelectorAll('p')].some((p) => p.textContent === etichetta))?.textContent ?? '';

describe('Panoramica admin', () => {
  it('646: tre ordini in viaggio non fanno «0% consegnati» né l’avviso degli ordini bloccati', async () => {
    const host = await apri(false);
    expect(riquadro(host, 'Tasso di consegna')).not.toMatch(/0,0\s*%/);
    expect(host.textContent).not.toMatch(/bloccati/);
    expect(riquadro(host, 'Tasso di consegna')).toMatch(/nessun ordine ancora lavorato/);
  });

  it('271: se la lettura dei tentativi cade, non dice «nessun tentativo registrato»', async () => {
    const host = await apri(true);
    expect(host.textContent).not.toContain('nessun tentativo con carta registrato');
    expect(host.textContent).toContain('non riesco a leggere i tentativi');
  });
});
