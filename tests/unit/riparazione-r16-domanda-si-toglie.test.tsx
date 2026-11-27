/**
 * @vitest-environment jsdom
 */
/**
 * R16-009 — Le domande sotto i prodotti: nessuno poteva toglierle dal sito. Adesso l'amministratore
 * nasconde una domanda (is_public = false, migrazione 364) e chi l'ha scritta cancella la sua
 * (migrazione 970); un altro cliente non vede nessun pulsante. Se il database non tocca niente,
 * il sito non dice «tolta».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const banco = vi.hoisted(() => ({
  profilo: { id: 'u-altro', isAdmin: false } as { id: string; isAdmin: boolean },
  domande: [] as Array<Record<string, unknown>>,
  scritture: [] as Array<{ azione: string; valori?: unknown; id?: unknown }>,
  righeToccate: 1,
  conferme: 0,
  esiti: { ok: [] as string[], ko: [] as string[] },
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => { banco.esiti.ok.push(m); }, error: (m: string) => { banco.esiti.ko.push(m); } },
}));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: async () => { banco.conferme++; return true; } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    isAuthenticated: true,
    profile: { id: banco.profilo.id },
    isAdmin: banco.profilo.isAdmin,
  }),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchNomiPubblici: async () => new Map([['u-autrice', 'Maria Rossi']]) }));
vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: banco.domande, error: null }).then(ok, ko);
    return q;
  };
  const scrittura = (azione: string, valori?: unknown) => ({
    eq: (_c: string, id: unknown) => ({
      select: async () => {
        banco.scritture.push({ azione, valori, id });
        return { data: Array.from({ length: banco.righeToccate }, () => ({ id })), error: null };
      },
    }),
  });
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: banco.profilo.id } } }) },
      from: () => ({
        select: () => lettura(),
        update: (valori: unknown) => scrittura('update', valori),
        delete: () => scrittura('delete'),
      }),
    },
  };
});

import ProductQA from '@/components/ProductQA';

const DOMANDE = [
  { id: 'q-maria', product_id: 'p-1', author_id: 'u-autrice', question: 'Chiamatemi al 3331234567', answer: null, answered_at: null, created_at: '2026-11-20T10:00:00Z' },
  { id: 'q-luca', product_id: 'p-1', author_id: 'u-luca', question: 'È senza glutine?', answer: null, answered_at: null, created_at: '2026-11-21T10:00:00Z' },
];

let smonta: (() => void) | null = null;
afterEach(() => {
  smonta?.();
  smonta = null;
  banco.scritture = [];
  banco.righeToccate = 1;
  banco.conferme = 0;
  banco.esiti = { ok: [], ko: [] };
});

async function assesta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function scheda(profilo: { id: string; isAdmin: boolean }) {
  banco.profilo = profilo;
  banco.domande = DOMANDE;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ProductQA, { productId: 'p-1', sellerId: 'n-pane' })));
  });
  await assesta();
  smonta = () => { act(() => root.unmount()); box.remove(); };
  expect(box.textContent, 'le domande devono essere a schermo').toContain('È senza glutine?');
  const pulsanti = (testo: string) => [...box.querySelectorAll('button')].filter((b) => b.textContent?.trim() === testo);
  return { box, pulsanti };
}

async function premi(b: Element) {
  await act(async () => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  await assesta();
}

describe('R16-009 · una domanda sotto il prodotto si toglie', () => {
  it('l\'amministratore nasconde una domanda (is_public = false), dopo una conferma', async () => {
    const { pulsanti } = await scheda({ id: 'u-capo', isAdmin: true });
    const nascondi = pulsanti('Nascondi');
    expect(nascondi, 'un pulsante per ogni domanda').toHaveLength(2);
    await premi(nascondi[0]);
    expect(banco.conferme).toBe(1);
    expect(banco.scritture).toEqual([{ azione: 'update', valori: { is_public: false }, id: 'q-maria' }]);
    expect(banco.esiti.ok).toContain('Domanda nascosta.');
  });

  it('chi ha scritto la domanda la cancella, e solo la sua', async () => {
    const { pulsanti } = await scheda({ id: 'u-autrice', isAdmin: false });
    const togli = pulsanti('Togli la mia domanda');
    expect(togli, 'il pulsante solo sulla domanda di Maria').toHaveLength(1);
    expect(togli[0].getAttribute('aria-label')).toContain('Chiamatemi al 3331234567');
    expect(pulsanti('Nascondi')).toHaveLength(0);
    await premi(togli[0]);
    expect(banco.scritture).toEqual([{ azione: 'delete', valori: undefined, id: 'q-maria' }]);
    expect(banco.esiti.ok).toContain('Domanda tolta.');
  });

  it('un altro cliente non vede nessun pulsante per togliere', async () => {
    const { pulsanti } = await scheda({ id: 'u-altro', isAdmin: false });
    expect(pulsanti('Nascondi')).toHaveLength(0);
    expect(pulsanti('Togli la mia domanda')).toHaveLength(0);
  });

  it('se il database non tocca niente, il sito non dice «tolta»', async () => {
    banco.righeToccate = 0;
    const { pulsanti } = await scheda({ id: 'u-autrice', isAdmin: false });
    await premi(pulsanti('Togli la mia domanda')[0]);
    expect(banco.esiti.ok).toHaveLength(0);
    expect(banco.esiti.ko.join(' ')).toMatch(/non è stata tolta/);
  });
});
