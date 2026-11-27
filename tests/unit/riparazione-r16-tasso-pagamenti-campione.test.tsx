// @vitest-environment jsdom
/**
 * R16-002 — La percentuale dei pagamenti con carta, oltre ventimila tentativi, diventava un campione
 * senza dirlo.
 *
 * La Panoramica legge i tentativi dei trenta giorni a finestre da mille, fino al tetto duro di
 * ventimila righe (`leggiTutteLeRighe`). Oltre il tetto la lettura si ferma ai più recenti e lo dice
 * (`troncato`), ma la pagina non lo guardava: la percentuale restava «Pagamenti riusciti (30 giorni)».
 * Qui il finto database ha sempre un'altra finestra piena: i tentativi sono più di ventimila.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta, type Domanda } from './aiuti/cabina-admin';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const KPI = { ordini_totali: 3, ordini_per_stato: { DELIVERED: 3 }, incassato_cents: 0 };

/** Una finestra di tentativi: nove su dieci riusciti. */
const finestra = (quanti: number) =>
  Array.from({ length: quanti }, (_, i) => ({
    status: i % 10 === 0 ? 'failed' : 'succeeded',
    decline_code: i % 10 === 0 ? 'insufficient_funds' : null,
    error_code: null,
  }));

async function apri(righePerRisposta: number) {
  fake.rispondi = (q: Domanda) => {
    if (q.op === 'rpc' && q.tabella === 'admin_kpi') return { data: KPI, error: null };
    // Il finto risponde sempre con la stessa finestra: con mille righe ce n'è sempre un'altra.
    if (q.tabella === 'payment_attempts') return { data: finestra(righePerRisposta), error: null };
    return { data: [], error: null };
  };
  const mod = (await import('@/app/admin/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  await aspetta(10);
  return r.host;
}

/** Il riquadro dei pagamenti con carta: quello con l'etichetta «Pagamenti riusciti …». */
const riquadroPagamenti = (host: HTMLElement) =>
  [...host.querySelectorAll('div.rounded-xl')].find((d) =>
    [...d.querySelectorAll('p')].some((p) => (p.textContent ?? '').startsWith('Pagamenti riusciti')),
  )?.textContent ?? '';

describe('R16-002 · la percentuale dei pagamenti con carta oltre il tetto della lettura', () => {
  it('oltre ventimila tentativi il riquadro dice che è un campione, e di quanti tentativi', async () => {
    const host = await apri(1000);
    await vi.waitFor(() => { if (!riquadroPagamenti(host).includes('su 20000')) throw new Error('tentativi non ancora letti'); }, { timeout: 3000 });
    const testo = riquadroPagamenti(host);
    expect(testo, 'la percentuale si calcola sui ventimila letti').toContain('18000 su 20000 tentativi con carta');
    expect(testo, 'il riquadro non dice che la percentuale è un campione').toMatch(/campione/i);
    expect(testo, 'il campione dice la sua dimensione').toContain((20_000).toLocaleString('it-IT'));
    expect(testo).not.toContain('Pagamenti riusciti (30 giorni)');
  });

  it('sotto il tetto la lettura è completa: niente «campione»', async () => {
    const host = await apri(500);
    await vi.waitFor(() => { if (!riquadroPagamenti(host).includes('su 500')) throw new Error('tentativi non ancora letti'); }, { timeout: 3000 });
    const testo = riquadroPagamenti(host);
    expect(testo).toContain('450 su 500 tentativi con carta');
    expect(testo).toContain('Pagamenti riusciti (30 giorni)');
    expect(testo).not.toMatch(/campione/i);
  });
});
