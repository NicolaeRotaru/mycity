/**
 * @vitest-environment jsdom
 */
/** 27/11/2026 — La pagina del servizio: per SDG il lavoro consegnato al posto del preventivo, per gli altri la pagina di sempre. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { costruisciPreventivo, leggiImpostazioniAgenzia } from '@/lib/agenzia/preventivo';

const stato = vi.hoisted(() => ({ slug: 'social', dati: {} as Record<string, unknown>, lavoroInLettura: false }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ servizio: stato.slug }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[]; enabled?: boolean }) => ({
    data: o.enabled === false ? undefined : stato.dati[String(o.queryKey[1])],
    isLoading: String(o.queryKey[1]) === 'lavoro-consegnato' && stato.lavoroInLettura,
    isError: false,
    refetch: () => undefined,
  }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => null }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import PaginaDelServizio from '@/app/seller/servizi/[servizio]/page';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';

const accesi: Root[] = [];
async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const d = document.createElement('div');
  document.body.appendChild(d);
  const root = createRoot(d);
  accesi.push(root);
  await act(async () => { root.render(createElement(PaginaDelServizio)); });
  return d;
}
const preventivo = () => costruisciPreventivo({
  idAttivita: '0de1905e-7000', nomeAttivita: 'Ora del Gusto', tipoAttivita: 'bar',
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'),
});

beforeEach(() => {
  stato.lavoroInLettura = false;
  stato.dati = { 'preventivo-agenzia': preventivo(), 'scheda-e-abbonamento': { scheda: null, aperta: false }, 'bozza-sito-ad': null };
});
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); document.body.innerHTML = ''; });

describe('la pagina del servizio con il lavoro consegnato', () => {
  it.each([['sito-web', 'sito-stato'], ['social', 'piano-calendario'], ['analisi', 'an-sintesi']])('per SDG %s mostra il lavoro e niente preventivo', async (slug, ancora) => {
    stato.slug = slug;
    stato.dati['lavoro-consegnato'] = { lavoro: lavoroConsegnatoDi(SDG_SELLER_ID), ordine: null };
    const r = await monta();
    expect(r.querySelector(`#${ancora}`)).not.toBeNull();
    expect(r.textContent).toContain('Premium · lavoro consegnato');
    expect(r.textContent).not.toContain('Scegli l’abbonamento');
    expect(r.textContent).not.toContain('Scegli l\'abbonamento');
    expect(r.textContent).not.toContain('Perché te lo proponiamo');
    expect(r.querySelector('a[href="/seller/abbonamento"]')).toBeNull();
  });

  it('un altro negozio, o la lettura senza lavoro, vede la pagina di oggi col pulsante', async () => {
    stato.slug = 'social';
    stato.dati['lavoro-consegnato'] = { lavoro: lavoroConsegnatoDi('0de1905e-7000-4000-8000-000000000001'), ordine: null }; // null
    const r = await monta();
    expect(r.textContent).toContain('È compreso in tutti e tre gli abbonamenti');
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toMatch(/Scegli l.abbonamento/);
    expect(r.textContent).not.toContain('Premium · lavoro consegnato');
  });

  it('foto e video resta il preventivo anche per SDG', async () => {
    stato.slug = 'foto-video';
    stato.dati['lavoro-consegnato'] = { lavoro: lavoroConsegnatoDi(SDG_SELLER_ID), ordine: null };
    const r = await monta();
    expect(r.querySelector('a[href="/seller/abbonamento"]')).not.toBeNull();
  });

  it('mentre legge il lavoro mostra solo il caricamento, senza lampo di preventivo', async () => {
    stato.slug = 'social';
    stato.lavoroInLettura = true;
    const r = await monta();
    expect(r.querySelector('a[href="/seller/abbonamento"]')).toBeNull();
  });
});
