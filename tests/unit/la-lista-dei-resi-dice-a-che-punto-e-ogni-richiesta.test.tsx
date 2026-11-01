// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * LA LISTA DEI RESI DICE A CHE PUNTO E' OGNI RICHIESTA.
 *
 * 1/11/2026 — La pagina dove porta la voce «Resi» del menu account: i resi del
 * cliente, con la stessa frase della pagina dell'ordine. Se la lettura fallisce
 * lo dice, invece di mostrare «nessun reso».
 */
const stato = vi.hoisted(() => ({
  resi: [] as unknown[],
  errore: null as unknown,
  filtro: null as null | [string, unknown],
}));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }) },
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          stato.filtro = [col, val];
          return { order: async () => ({ data: stato.errore ? null : stato.resi, error: stato.errore }) };
        },
      }),
    }),
  },
}));

import IMieiResiPage from '@/app/orders/resi/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;
async function monta() {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(IMieiResiPage)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
afterEach(async () => {
  await act(async () => root.unmount());
  contenitore.remove();
  stato.errore = null;
});

describe('i miei resi', () => {
  it('un reso in attesa e uno rimborsato: due righe con lo stato e il link all\'ordine', async () => {
    stato.resi = [
      { id: 'r2', order_id: 'o2', status: 'REQUESTED', created_at: '2026-10-30T10:00:00Z' },
      { id: 'r1', order_id: 'o1', status: 'REFUNDED', created_at: '2026-10-01T10:00:00Z' },
    ];
    await monta();
    expect(stato.filtro).toEqual(['buyer_id', 'b1']);
    expect(contenitore.textContent).toMatch(/Reso richiesto: il negozio deve ancora rispondere/);
    expect(contenitore.textContent).toMatch(/Reso rimborsato/);
    const link = Array.from(contenitore.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(link).toContain('/orders/o2');
    expect(link).toContain('/orders/o1');
  });

  it('lettura fallita: lo dice, non mostra «Nessun reso»', async () => {
    stato.errore = { message: 'rete' };
    await monta();
    expect(contenitore.querySelector('[role="alert"]')).toBeTruthy();
    expect(contenitore.textContent).not.toMatch(/Nessun reso/);
  });
});
