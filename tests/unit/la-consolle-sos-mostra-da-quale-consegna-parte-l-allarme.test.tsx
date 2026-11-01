/**
 * @vitest-environment jsdom
 */
/**
 * 1/11/2026 — LA CONSOLLE SOS NON DICEVA DA QUALE CONSEGNA PARTIVA L'ALLARME.
 *
 * Il pulsante SOS del fattorino scrive anche l'ordine che stava portando
 * (`order_id`). La consolle lo leggeva nella select e poi non lo mostrava da
 * nessuna parte: la scheda aveva solo nome, telefono e ora. Se in piu' la
 * posizione non era arrivata (lat nulla), chi doveva aiutare non sapeva ne'
 * dove ne' per quale consegna.
 *
 * Qui si monta la pagina VERA con React Query vero; la banca dati e' finta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import QueryProvider from '@/components/providers/QueryProvider';

const stato = vi.hoisted(() => ({ righe: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from() {
      const catena = {
        select: () => catena,
        order: () => catena,
        limit: () => Promise.resolve({ data: stato.righe, error: null }),
      };
      return catena;
    },
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminSOSPage from '@/app/admin/sos/page';

let root: Root | null = null;
let box: HTMLDivElement;

async function monta() {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  await act(async () => {
    root!.render(createElement(QueryProvider, null, createElement(AdminSOSPage)));
  });
  for (let i = 0; i < 20 && !box.textContent?.includes('Mario'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  box?.remove();
});

const base = {
  rider_id: 'r1',
  lat: null,
  lng: null,
  triggered_at: new Date().toISOString(),
  resolution_note: null,
  rider: { full_name: 'Mario Rossi', phone: '+390000' },
};

describe('la consolle SOS mostra da quale consegna parte l’allarme', () => {
  it('SOS attivo con order_id e senza posizione: c’e’ il collegamento all’ordine', async () => {
    stato.righe = [{ ...base, id: 's1', order_id: 'ord-42', resolved_at: null }];
    await monta();
    expect(box.textContent).toContain('Mario Rossi');
    const link = box.querySelector('a[href="/admin/orders/ord-42"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Consegna #ORD-42');
  });

  it('SOS risolto con order_id: anche lo storico porta all’ordine', async () => {
    stato.righe = [
      { ...base, id: 's2', order_id: 'ord-77', resolved_at: new Date().toISOString(), resolution_note: 'falso allarme' },
    ];
    await monta();
    expect(box.querySelector('a[href="/admin/orders/ord-77"]')).not.toBeNull();
  });

  it('SOS senza ordine: si dice che non era in consegna, nessun collegamento finto', async () => {
    stato.righe = [{ ...base, id: 's3', order_id: null, resolved_at: null }];
    await monta();
    expect(box.querySelector('a[href^="/admin/orders/"]')).toBeNull();
    expect(box.textContent).toContain('Non era in consegna');
  });
});
