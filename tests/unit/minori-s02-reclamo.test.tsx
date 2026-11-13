// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';

/**
 * Sessione S02 (5/11/2026) — la pagina «Apri un reclamo».
 *  · 1727: una lettura caduta non diventa «Ordine non trovato» con rinvio a /orders, ma «Riprova»;
 *  · 1728: con un reclamo già aperto la pagina lo dice (data e stato) al posto del modulo, e il
 *          doppione rifiutato dal database si traduce con una frase vera;
 *  · 659:  «Motivo del reclamo» è la legenda del gruppo di scelte (fieldset), non una label vuota.
 */
const stato = vi.hoisted(() => ({
  letturaOrdine: { data: null as unknown, error: null as unknown },
  aperti: [] as Array<{ created_at: string; status: string }>,
  push: [] as string[],
  erroreInsert: null as unknown,
  toastErrore: [] as string[],
}));

// React 18 nelle prove: `use(params)` si fa restituire l'id dell'ordine.
vi.mock('react', async (originale) => ({ ...(await originale<Record<string, unknown>>()), use: () => ({ id: 'o1' }) }));
const router = vi.hoisted(() => ({ push: (u: string) => { (globalThis as { __push?: string[] }).__push?.push(u); } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => stato.toastErrore.push(m) } }));
vi.mock('@/lib/queries/negozio-dell-ordine', () => ({
  conNegozioDellOrdine: async (_s: unknown, righe: unknown[]) => righe.map((r) => ({ ...(r as object), seller: { store_name: 'Pane Quotidiano' } })),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }) },
    from: (tabella: string) => {
      if (tabella === 'orders') return { select: () => ({ eq: () => ({ maybeSingle: async () => stato.letturaOrdine }) }) };
      return {
        select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: stato.aperti, error: null }) }) }) }),
        insert: async () => ({ error: stato.erroreInsert }),
      };
    },
  },
}));

import OpenDisputePage from '@/app/orders/[id]/dispute/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const ORDINE = { id: 'o1', total_price: 10, delivery_status: 'DELIVERED', seller_id: 's1', created_at: '2026-11-01T10:00:00Z' };

async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  const params = Promise.resolve({ id: 'o1' });
  await act(async () => root.render(createElement(Suspense, { fallback: null }, createElement(OpenDisputePage, { params }))));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  stato.letturaOrdine = { data: ORDINE, error: null };
  stato.aperti = [];
  stato.push = [];
  (globalThis as { __push?: string[] }).__push = stato.push;
  stato.erroreInsert = null;
  stato.toastErrore = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
});

describe('la pagina del reclamo', () => {
  it('1727 · lettura caduta: «Non riesco a caricare l ordine» con Riprova, nessun rinvio a /orders', async () => {
    stato.letturaOrdine = { data: null, error: { message: 'TypeError: fetch failed' } };
    await monta();
    expect(c.textContent).toContain('Non riesco a caricare');
    expect(stato.push).toEqual([]);
    expect(stato.toastErrore).not.toContain('Ordine non trovato');
  });

  it('1727 · ordine che non c è (nessun dato, nessun errore): resta «Ordine non trovato»', async () => {
    stato.letturaOrdine = { data: null, error: null };
    await monta();
    expect(stato.toastErrore).toContain('Ordine non trovato');
    expect(stato.push).toEqual(['/orders']);
  });

  it('1728 · reclamo già aperto: la pagina lo dice al posto del modulo', async () => {
    stato.aperti = [{ created_at: '2026-10-13T09:00:00Z', status: 'under_review' }];
    await monta();
    expect(c.textContent).toContain('Hai già un reclamo aperto');
    expect(c.textContent).toContain('13/10/2026');
    expect(c.textContent).toContain('in esame');
    expect(c.querySelector('form')).toBeNull();
  });

  it('1728 · il doppione rifiutato dal database si dice con una frase vera', async () => {
    stato.erroreInsert = { code: '23505', message: 'duplicate key value violates unique constraint "disputes_one_open_per_order"' };
    // 12/11/2026 (R03-013) — il reclamo lo apre /api/disputes: il doppione rifiutato dal database
    // torna dalla rotta come 409 con la frase vera (app/api/disputes/route.ts).
    const fetchDiPrima = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: { code: 'CONFLICT', message: 'Hai già un reclamo aperto su questo ordine: lo stiamo esaminando, ti scriviamo noi.' } }), { status: 409 })) as typeof fetch;
    await monta();
    const radio = c.querySelector('input[type=radio][value=damaged]') as HTMLInputElement;
    await act(async () => { radio.click(); });
    const area = c.querySelector('textarea') as HTMLTextAreaElement;
    const imposta = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      imposta.call(area, 'Il pane è arrivato tutto schiacciato nella busta');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (c.querySelector('form') as HTMLFormElement).requestSubmit();
      await new Promise((r) => setTimeout(r, 0));
    });
    globalThis.fetch = fetchDiPrima;
    expect(stato.toastErrore.join(' ')).toContain('già un reclamo aperto');
    expect(stato.toastErrore.join(' ')).not.toContain('già stato usato');
  });

  it('659 · «Motivo del reclamo» è la legenda di un fieldset', async () => {
    await monta();
    const legenda = c.querySelector('fieldset > legend');
    expect(legenda?.textContent).toContain('Motivo del reclamo');
    expect(c.querySelector('fieldset')?.querySelectorAll('input[type=radio]').length).toBeGreaterThan(3);
  });
});

describe('659 · reso e buono regalo', () => {
  it('nel reso il motivo è la legenda del gruppo; nel buono regalo l importo scelto ha aria-pressed', () => {
    const reso = readFileSync('app/orders/[id]/return/page.tsx', 'utf8');
    expect(reso).toMatch(/<legend[^>]*>\s*Motivo del reso/);
    const buono = readFileSync('app/profile/gift-cards/page.tsx', 'utf8');
    expect(buono).toMatch(/aria-pressed=\{amount === a\}/);
    expect(buono).toMatch(/role="group"/);
  });
});
