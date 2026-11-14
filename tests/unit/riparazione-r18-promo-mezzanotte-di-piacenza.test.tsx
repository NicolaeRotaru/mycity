/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';

/**
 * R18-011 — La promo «Oggi (fino a mezzanotte)» finiva a mezzanotte del fuso del telefono:
 * endDateFor faceva setHours(23, 59, 59, 999) nel fuso del browser. Il negoziante a New York
 * il 6/11 regalava sei ore di sconto in più a Piacenza; da Tokyo la promo finiva alle 15:59.
 * Anche le date mostrate (anteprima, «Fino al», «Terminata») erano nel fuso del telefono.
 *
 * Orologio finto, e il fuso del processo NON è quello di Roma: la fine salvata deve essere
 * l'ultimo istante del giorno di Piacenza, d'inverno, d'estate e nelle domeniche del cambio d'ora.
 */

type Op = { tabella: string; azione: string; valori?: unknown };
const stato: { ops: Op[]; promo: unknown[] } = { ops: [], promo: [] };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select' };
  const esito = () => (tabella === 'seller_promotions' && op.azione === 'select' ? { data: stato.promo, error: null } : { data: [], error: null });
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or', 'in', 'eq', 'neq']) q[m] = () => q;
  q.insert = (v: unknown) => { op.azione = 'insert'; op.valori = v; return q; };
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    return Promise.resolve(esito()).then(ok, ko);
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function conQuery(Pagina: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Avvolta() {
    return createElement(QueryClientProvider, { client }, createElement(Pagina));
  };
}

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(testo)) as HTMLButtonElement | undefined;

const fusoDiPrima = process.env.TZ;

beforeEach(() => {
  stato.ops = [];
  stato.promo = [];
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = fusoDiPrima;
  document.body.innerHTML = '';
});

/** Apre «Nuova promo», sceglie «Oggi (fino a mezzanotte)», preme «Crea promo»: torna ends_at e l'anteprima. */
async function creaPromoDiOggi(fuso: string, adesso: string): Promise<{ ends: string; anteprima: string }> {
  stato.ops = [];
  process.env.TZ = fuso;
  vi.setSystemTime(new Date(adesso));
  const { default: Pagina } = await import('@/app/seller/promotions/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  s.agisci(() => pulsante('Nuova promo')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await aspetta();
  const durata = Array.from(document.querySelectorAll('select')).find((el) => Array.from(el.options).some((o) => o.value === 'today')) as HTMLSelectElement;
  s.agisci(() => {
    durata.value = 'today';
    durata.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await aspetta();
  const anteprima = Array.from(document.querySelectorAll('p')).find((p) => (p.textContent ?? '').includes('fino al'))?.textContent ?? '';
  s.agisci(() => pulsante('Crea promo')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await aspetta();
  const inserita = stato.ops.find((o) => o.tabella === 'seller_promotions' && o.azione === 'insert')?.valori as { ends_at?: string } | undefined;
  s.smonta();
  expect(inserita, 'la promo non è stata inserita').toBeTruthy();
  return { ends: inserita!.ends_at!, anteprima };
}

describe('R18-011 — «Oggi, fino a mezzanotte» finisce a mezzanotte di Piacenza', () => {
  it('d’inverno, da New York: il 6/11 finisce alle 23:59:59.999 di Piacenza (22:59 UTC), non alle 5:59 del 7/11', async () => {
    const { ends, anteprima } = await creaPromoDiOggi('America/New_York', '2026-11-06T10:00:00Z');
    expect(ends).toBe('2026-11-06T22:59:59.999Z');
    expect(anteprima).toContain('fino al 06/11/2026');
  });

  it('d’estate, da New York: il 15/7 finisce alle 21:59:59.999 UTC (ora legale a Piacenza)', async () => {
    const { ends } = await creaPromoDiOggi('America/New_York', '2026-07-15T10:00:00Z');
    expect(ends).toBe('2026-07-15T21:59:59.999Z');
  });

  it('da New York alle 21 del 6/11 a Piacenza è già il 7/11: la promo dura fino alla mezzanotte del 7', async () => {
    const { ends, anteprima } = await creaPromoDiOggi('America/New_York', '2026-11-07T02:00:00Z');
    expect(ends).toBe('2026-11-07T22:59:59.999Z');
    expect(anteprima).toContain('fino al 07/11/2026');
  });

  it('da Tokyo non finisce nel pomeriggio', async () => {
    const { ends } = await creaPromoDiOggi('Asia/Tokyo', '2026-11-06T10:00:00Z');
    expect(ends).toBe('2026-11-06T22:59:59.999Z');
  });

  it('nelle domeniche del cambio d’ora (25 ottobre e 29 marzo) la mezzanotte è quella giusta', async () => {
    expect((await creaPromoDiOggi('America/New_York', '2026-10-25T10:00:00Z')).ends).toBe('2026-10-25T22:59:59.999Z');
    expect((await creaPromoDiOggi('America/New_York', '2026-03-29T10:00:00Z')).ends).toBe('2026-03-29T21:59:59.999Z');
  });

  it('le date mostrate sono quelle di Piacenza: «Fino al 6 nov, 23:59» e «Terminata 01/11/2026» anche da New York', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    stato.promo = [
      { id: 'p-oggi', title: 'Promo di oggi', discount_percent: 15, scope: 'store', starts_at: '2026-11-06T09:00:00Z', ends_at: '2026-11-06T22:59:59.999Z', status: 'active' },
      { id: 'p-vecchia', title: 'Promo vecchia', discount_percent: 20, scope: 'store', starts_at: '2026-10-25T09:00:00Z', ends_at: '2026-11-01T22:59:59.999Z', status: 'active' },
    ];
    const { default: Pagina } = await import('@/app/seller/promotions/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const testo = document.body.textContent ?? '';
    expect(testo).toMatch(/Fino al 6 nov,? 23:59/);
    expect(testo).toContain('Terminata 01/11/2026');
    s.smonta();
  });
});
