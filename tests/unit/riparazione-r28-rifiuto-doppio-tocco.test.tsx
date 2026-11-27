/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Il doppio tocco su «Rifiuta ordine» nella pagina dell'ordine del negozio.
 * ① Il pulsante si spegneva con `isPending`, che arriva al secondo clic troppo tardi: qui
 *    `isPending` resta falso, come nell'istante fra i due tocchi, e la richiesta deve partire una
 *    volta sola.
 * ② Il 409 «Ordine già annullato» arrivato dopo il rifiuto riuscito non è un avviso rosso.
 * ③ Il 409 «è cambiato nel frattempo» (un collega l'ha segnato pronto) resta un errore che dice
 *    di ricaricare: l'ordine è vivo.
 */

const ID = '11111111-2222-3333-4444-555555555555';
const stato = vi.hoisted(() => ({
  mutate: [] as unknown[],
  opzioni: [] as Array<Record<string, unknown>>,
}));
const avvisi = vi.hoisted(() => ({ success: [] as string[], error: [] as string[], neutro: [] as string[] }));

vi.mock('react', async (orig) => {
  const vero = await orig<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => {
  const toast = Object.assign((m: string) => { avvisi.neutro.push(m); }, {
    success: (m: string) => { avvisi.success.push(m); },
    error: (m: string) => { avvisi.error.push(m); },
    info: (m: string) => { avvisi.neutro.push(m); },
  });
  return { toast };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (o: Record<string, unknown>) => {
    stato.opzioni.push(o);
    return { mutate: (v: unknown) => { stato.mutate.push(v); }, isPending: false };
  },
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(queryKeys.seller.order(ID))) {
      return {
        data: {
          id: ID, user_id: 'b1', delivery_status: 'NEW', created_at: '2026-11-08T09:00:00Z',
          pickup_in_store: false, total_price: 18, shipping_cost: 3, payment_method: 'cod',
          delivery_slot: null, order_items: [], rider: null, seller: null,
        },
        isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0, errorUpdatedAt: 0,
      };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

const { default: Pagina } = await import('@/app/seller/orders/[id]/page');

const accesi: Root[] = [];

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.mutate = [];
  stato.opzioni = [];
  avvisi.success = [];
  avvisi.error = [];
  avvisi.neutro = [];
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(Pagina, { params: { valore: { id: ID } } as unknown as Promise<{ id: string }> }));
  });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const pulsante = (testo: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === testo) as HTMLButtonElement;

/** Le opzioni dell'ultima mutazione del rifiuto disegnata: quella che chiama la rotta /reject. */
function opzioniDelRifiuto() {
  const o = [...stato.opzioni].reverse().find((x) => String(x.mutationFn).includes('/reject'));
  if (!o) throw new Error('mutazione del rifiuto non trovata');
  return o as { mutationFn: (r?: string) => Promise<unknown>; onSuccess: (esito: unknown) => void; onError: (e: unknown) => void };
}

/** Fa girare la mutazione come React Query: esito a onSuccess, errore a onError. */
async function giro(risposta: Response) {
  const o = opzioniDelRifiuto();
  vi.stubGlobal('fetch', vi.fn(async () => risposta));
  await act(async () => {
    try {
      o.onSuccess(await o.mutationFn(undefined));
    } catch (e) {
      o.onError(e);
    }
  });
}
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const conflitto = (message: string) => new Response(JSON.stringify({ ok: false, error: { code: 'CONFLICT', message } }), { status: 409 });

describe('il doppio tocco su «Rifiuta ordine»', () => {
  it('due clic prima che il pulsante si spenga: una richiesta sola', async () => {
    await act(async () => { fireEvent.click(pulsante('Rifiuta')); });
    const conferma = pulsante('Rifiuta ordine');
    expect(conferma).toBeTruthy();
    act(() => {
      fireEvent.click(conferma);
      fireEvent.click(conferma);
    });
    expect(stato.mutate).toHaveLength(1);
  });

  it('il 409 «Ordine già annullato» dopo il rifiuto riuscito non accende un avviso rosso', async () => {
    await giro(ok());
    await giro(conflitto('Ordine già annullato'));
    expect(avvisi.error).toEqual([]);
    expect(avvisi.success).toEqual(['Ordine rifiutato']);
    expect(avvisi.neutro).toEqual([]);
  });

  it('il 409 «è cambiato nel frattempo» resta un errore che invita a ricaricare', async () => {
    await giro(conflitto("L'ordine è cambiato nel frattempo: ricarica la pagina."));
    expect(avvisi.success).toEqual([]);
    expect(avvisi.neutro).toEqual([]);
    expect(avvisi.error).toHaveLength(1);
    expect(avvisi.error[0]).toMatch(/ricarica/i);
  });
});
