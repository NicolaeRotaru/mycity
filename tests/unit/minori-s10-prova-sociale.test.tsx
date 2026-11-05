// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * S10 (5/11/2026, schede 256 e 732) — «Ordinato N volte negli ultimi 7 giorni»
 * conta gli ordini di tutti con una funzione del database che restituisce un
 * numero, invece di scaricare le righe d'ordine (che ognuno vede solo sue).
 */

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) },
}));

import { SocialProof } from '@/components/ui/SocialProof';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function monta() {
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(SocialProof, { productId: 'p-1' }))));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
}

describe('la prova sociale chiede un numero al database (256, 732)', () => {
  it('usa la funzione ordini_recenti_del_prodotto e non legge order_items', async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    await monta();
    expect(rpcMock).toHaveBeenCalledWith('ordini_recenti_del_prodotto', { p_product_id: 'p-1' });
    expect(fromMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Ordinato 5 volte/);
  });
  it('se la funzione non risponde, niente scritta', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    await monta();
    expect(document.body.textContent).not.toMatch(/Ordinato/);
  });
  it('la migrazione conta ordini distinti, non annullati, con SECURITY DEFINER', () => {
    const sql = readFileSync('migrations/245_la_prova_sociale_conta_gli_ordini_di_tutti.sql', 'utf8');
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/COUNT\(DISTINCT oi\.order_id\)/);
    expect(sql).toMatch(/<> 'CANCELED'/);
    expect(sql).toMatch(/interval '7 days'/);
  });
});
