/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — Nicola: «il link all'abbonamento sia il preventivo personalizzato in base all'azienda
 * e all'abbonamento». Scelta sua: ogni fascia del riquadro apre il SUO preventivo.
 *
 *  · nel riquadro della dashboard Base, Business e Premium sono tre link a /seller/abbonamento?fascia=…;
 *  · la pagina Abbonamento aperta con ?fascia=premium è il preventivo di quell'attività col Premium:
 *    titolo, fascia scelta, offerta su misura e pulsante di pagamento sono del Premium;
 *  · una fascia sconosciuta nell'indirizzo non rompe niente: vale la consigliata;
 *  · cambiando fascia cambia anche l'indirizzo.
 *
 * L'impalcatura (finti di react-query, supabase, profilo e la vetrina di Pane Quotidiano) è la
 * stessa di i-servizi-sono-tre-e-l-abbonamento-sta-in-dashboard.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  pathname: '/seller/dashboard',
  slug: 'foto-video',
  preventivo: null as unknown,
  inVetrina: false as boolean | null,
  approvato: true,
  erroreLettura: false,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  useParams: () => ({ servizio: stato.slug }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    if (o.queryKey[1] === 'preventivo-agenzia') {
      return stato.erroreLettura
        ? { data: undefined, isLoading: false, isError: true, error: new Error('guasto'), refetch: () => undefined }
        : { data: stato.preventivo, isLoading: false, isError: false, refetch: () => undefined };
    }
    if (o.queryKey[1] === 'in-vetrina') return { data: stato.inVetrina };
    return { data: 0 };
  },
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}), rpc: async () => ({ data: null }) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 's-1', role: 'seller', store_name: 'Pane Quotidiano', is_approved: stato.approvato },
    userEmail: 'p@p.it', isAuthenticated: true, isSeller: true,
  }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import {
  FASCE, ABBONAMENTI, costruisciPreventivo, leggiImpostazioniAgenzia, type Preventivo,
} from '@/lib/agenzia/preventivo';
import { fasciaDaIndirizzo, hrefFascia } from '@/lib/agenzia/indirizzi-servizi';
import RiquadroAbbonamento from '@/components/seller/RiquadroAbbonamento';
import PaginaAbbonamento from '@/app/seller/abbonamento/page';


const accesi: Root[] = [];
async function monta(componente: unknown, props?: Record<string, unknown> | null, figli?: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, (props ?? null) as never, figli as never)); });
  return radice;
}

/** Una vetrina come quella di Pane Quotidiano: 1 foto del locale, nessun video, nessun sito. */
const vetrina = (attivo: Preventivo['attivo'] = null): Preventivo => costruisciPreventivo({
  idAttivita: 'a1b2c3', nomeAttivita: 'Pane Quotidiano', tipoAttivita: 'negozio',
  dati: { storeLogo: null, storeMedia: [{ type: 'image', url: 'https://x/1.jpg' }], prodotti: [{ images: ['a.jpg'] }], socials: { instagram: 'pane' } },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-24T10:00:00Z'), attivo,
});

beforeEach(() => {
  stato.pathname = '/seller/dashboard';
  stato.slug = 'foto-video';
  stato.preventivo = vetrina();
  stato.inVetrina = false;
  stato.approvato = true;
  stato.erroreLettura = false;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});


/** La fascia spuntata. Si guarda la proprietà `checked`: il selettore :checked di jsdom legge l'attributo, che React scrive solo al primo disegno. */
const spuntata = (r: Element) => [...r.querySelectorAll<HTMLInputElement>('input[name="abbonamento"]')].find((i) => i.checked)?.value;

function vaiA(cerca: string) {
  window.history.replaceState(null, '', `/seller/abbonamento${cerca}`);
}

describe('ogni fascia apre il suo preventivo', () => {
  afterEach(() => vaiA(''));

  it('nel riquadro della dashboard le tre fasce sono link al loro preventivo', async () => {
    const r = await monta(RiquadroAbbonamento, { posizione: 'cima' });
    for (const f of ABBONAMENTI) {
      const link = r.querySelector(`a[href="/seller/abbonamento?fascia=${f}"]`);
      expect(link, f).not.toBeNull();
      expect(link!.textContent).toContain(FASCE[f].nome);
      expect(link!.getAttribute('aria-label')).toContain(`Il preventivo col ${FASCE[f].nome}`);
    }
  });

  it('con ?fascia=premium la pagina è il preventivo dell attività col Premium', async () => {
    vaiA('?fascia=premium');
    const r = await monta(PaginaAbbonamento);
    expect(r.querySelector('h1')?.textContent).toBe('Il preventivo di Pane Quotidiano col Premium');
    expect(spuntata(r)).toBe('premium');
    expect(r.textContent).toContain('Paga e attiva il Premium');
  });

  it('senza fascia, o con una sconosciuta, vale quella consigliata', async () => {
    const consigliato = (stato.preventivo as Preventivo).consigliato;
    for (const cerca of ['', '?fascia=gold']) {
      vaiA(cerca);
      const r = await monta(PaginaAbbonamento);
      expect(spuntata(r), cerca).toBe(consigliato);
      expect(r.querySelector('h1')?.textContent).toBe(`Il preventivo di Pane Quotidiano col ${FASCE[consigliato].nome}`);
    }
  });

  it('cambiando fascia cambiano il preventivo e l indirizzo', async () => {
    vaiA('?fascia=base&pagato=0');
    const r = await monta(PaginaAbbonamento);
    const business = r.querySelector<HTMLInputElement>('input[value="business"]')!;
    await act(async () => { business.click(); });
    expect(window.location.search).toBe('?fascia=business');
    expect(spuntata(r)).toBe('business');
    expect(r.querySelector('h1')?.textContent).toBe('Il preventivo di Pane Quotidiano col Business');
  });

  it('ad abbonamento fatto la pagina non si chiama preventivo', async () => {
    stato.preventivo = vetrina({ fascia: 'business', stato: 'active', rinnovoIl: null });
    vaiA('?fascia=premium');
    const r = await monta(PaginaAbbonamento);
    expect(r.querySelector('h1')?.textContent).toBe('Il tuo abbonamento Business');
  });

  it('la fascia dell indirizzo si legge solo se è una delle tre', () => {
    expect(fasciaDaIndirizzo('Business')).toBe('business');
    expect(fasciaDaIndirizzo('gold')).toBeNull();
    expect(fasciaDaIndirizzo(null)).toBeNull();
    expect(hrefFascia('base')).toBe('/seller/abbonamento?fascia=base');
    expect(hrefFascia('base', '/preventivo/ABC123/abbonamento')).toBe('/preventivo/ABC123/abbonamento?fascia=base');
  });
});
