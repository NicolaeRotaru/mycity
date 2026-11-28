/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — Nicola, sulla pagina «Sito web» di «PROVA - Raquel Cafè», negozio col Business già attivo:
 * «perché c'è la scelta dell'abbonamento se il cliente è già iscritto, controlla ovunque è rimasto e toglielo».
 *
 * Chi ha già un abbonamento (attivo, o col pagamento in ritardo) non vede più la scelta:
 *  · nella pagina di ogni servizio, niente «È compreso in tutti e tre gli abbonamenti» né «Scegli l'abbonamento»;
 *  · nella pagina Abbonamento, niente «Base, Business o Premium» con le tre fasce da spuntare;
 *  · nella schermata «in attesa di approvazione», niente pulsante «Scegli l'abbonamento»;
 *  · nella pagina prodotto di un abbonamento di SDG, il pulsante dice «Vedi il tuo abbonamento».
 * Chi non è abbonato continua a vedere tutto come prima: la prova lo controlla accanto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  pathname: '/seller/servizi/sito-web',
  slug: 'sito-web',
  preventivo: null as unknown,
  approvato: true,
  richiesta: null as unknown,
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
  useQuery: (o: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    if (o.enabled === false) return { data: undefined, isLoading: false, isError: false, status: 'pending', refetch: () => undefined };
    if (o.queryKey[1] === 'preventivo-agenzia') {
      return stato.erroreLettura
        ? { data: undefined, isLoading: false, isError: true, status: 'error', refetch: () => undefined }
        : { data: stato.preventivo, isLoading: false, isError: false, status: 'success', refetch: () => undefined };
    }
    if (o.queryKey[1] === 'stato-richiesta-negozio') return { data: stato.richiesta, isLoading: false, isError: false, status: 'success', refetch: () => undefined };
    return { data: undefined, isLoading: false, isError: false, status: 'success', refetch: () => undefined };
  },
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}), rpc: async () => ({ data: null }) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 's-1', role: 'seller', store_name: 'PROVA - Raquel Cafè', is_approved: stato.approvato },
    userEmail: 'r@r.it', isAuthenticated: true, isSeller: true, isAdmin: false, isBuyer: false, isRider: false,
    isLoading: false, isError: false, refetch: () => undefined,
  }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import { SERVIZI_AGENZIA, SLUG_SERVIZIO, costruisciPreventivo, leggiImpostazioniAgenzia, type Preventivo } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { doveSiAttivaLAbbonamento } from '@/lib/products/sdgSeller';
import { AttivaAbbonamento } from '@/components/products/AttivaAbbonamento';
import PaginaDelServizio from '@/app/seller/servizi/[servizio]/page';
import PaginaAbbonamento from '@/app/seller/abbonamento/page';
import SellerLayout from '@/app/seller/layout';

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

/** Un bar senza sito, come Raquel Cafè. */
const vetrina = (attivo: Preventivo['attivo'] = null): Preventivo => costruisciPreventivo({
  idAttivita: 'ffb27a', nomeAttivita: 'PROVA - Raquel Cafè', tipoAttivita: 'bar',
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-28T10:00:00Z'), attivo,
});
const ABBONATI: Array<NonNullable<Preventivo['attivo']>> = [
  { fascia: 'business', stato: 'active', rinnovoIl: null },
  { fascia: 'premium', stato: 'past_due', rinnovoIl: null },
];
const pulsanteScegli = (r: HTMLElement) =>
  [...r.querySelectorAll('a, button')].filter((e) => /Scegli l['’]abbonamento/.test(e.textContent ?? ''));

beforeEach(() => {
  stato.pathname = '/seller/servizi/sito-web';
  stato.slug = 'sito-web';
  stato.preventivo = vetrina();
  stato.approvato = true;
  stato.richiesta = null;
  stato.erroreLettura = false;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('la pagina di un servizio', () => {
  it('a chi è già abbonato non mostra le tre fasce né «Scegli l’abbonamento», in nessun servizio', async () => {
    for (const attivo of ABBONATI) {
      for (const id of SERVIZI_AGENZIA) {
        stato.slug = SLUG_SERVIZIO[id];
        stato.preventivo = vetrina(attivo);
        const r = await monta(PaginaDelServizio);
        const chi = `${id} · ${attivo.stato}`;
        expect(r.querySelector('[id="compreso-nei-piani"]'), chi).toBeNull();
        expect(r.textContent, chi).not.toContain('È compreso in tutti e tre gli abbonamenti');
        expect(pulsanteScegli(r), chi).toHaveLength(0);
      }
    }
  });

  it('a chi non è abbonato le mostra come prima', async () => {
    for (const id of SERVIZI_AGENZIA) {
      stato.slug = SLUG_SERVIZIO[id];
      stato.preventivo = vetrina(null);
      const r = await monta(PaginaDelServizio);
      expect(r.querySelector('[id="compreso-nei-piani"]'), id).not.toBeNull();
      expect(pulsanteScegli(r).length, id).toBeGreaterThan(0);
    }
  });
});

describe('la pagina Abbonamento', () => {
  it('a chi è già abbonato non fa più scegliere tra Base, Business e Premium', async () => {
    for (const attivo of ABBONATI) {
      stato.preventivo = vetrina(attivo);
      const r = await monta(PaginaAbbonamento);
      expect(r.querySelector('[id="le-tre-fasce"]'), attivo.stato).toBeNull();
      expect(r.querySelectorAll('input[name="abbonamento"]'), attivo.stato).toHaveLength(0);
      expect(r.textContent, attivo.stato).toContain(`Il tuo abbonamento`);
    }
  });

  it('a chi non è abbonato fa scegliere come prima', async () => {
    const r = await monta(PaginaAbbonamento);
    expect(r.querySelector('[id="le-tre-fasce"]')).not.toBeNull();
    expect(r.querySelectorAll('input[name="abbonamento"]')).toHaveLength(3);
  });
});

describe('la schermata «in attesa di approvazione»', () => {
  const inAttesa = () => {
    stato.approvato = false;
    stato.pathname = '/seller/orders';
    stato.richiesta = { approval_status: 'pending', approval_requested_at: '2026-11-28T09:33:53Z', rejection_reason: null };
  };

  it('non mostra «Scegli l’abbonamento» a chi l’ha già, né quando non si sa', async () => {
    inAttesa();
    for (const preventivo of [vetrina(ABBONATI[0]), vetrina(ABBONATI[1]), undefined]) {
      stato.preventivo = preventivo;
      const r = await monta(SellerLayout, null, createElement('p', null, 'figli'));
      expect(r.textContent).toContain('Negozio in attesa di approvazione');
      expect(pulsanteScegli(r)).toHaveLength(0);
    }
  });

  it('lo mostra come prima a chi non è abbonato', async () => {
    inAttesa();
    stato.preventivo = vetrina(null);
    const r = await monta(SellerLayout, null, createElement('p', null, 'figli'));
    const pulsanti = pulsanteScegli(r);
    expect(pulsanti).toHaveLength(1);
    expect(pulsanti[0].getAttribute('href')).toBe(PERCORSO_ABBONAMENTO);
  });
});

describe('la pagina prodotto di un abbonamento di SDG', () => {
  it('a un negozio già abbonato dice «Vedi il tuo abbonamento»', async () => {
    expect(doveSiAttivaLAbbonamento(true, true)).toEqual({ href: PERCORSO_ABBONAMENTO, testo: 'Vedi il tuo abbonamento' });
    const r = await monta(AttivaAbbonamento, { chiGuardaEUnNegozio: true, giaAbbonato: true });
    expect(r.textContent).toContain('Vedi il tuo abbonamento');
    expect(pulsanteScegli(r)).toHaveLength(0);
  });

  it('finché non si sa se è abbonato non promette la scelta', async () => {
    expect(doveSiAttivaLAbbonamento(true, null)).toEqual({ href: PERCORSO_ABBONAMENTO, testo: 'Vai alla pagina Abbonamento del tuo negozio' });
    const r = await monta(AttivaAbbonamento, { chiGuardaEUnNegozio: true, giaAbbonato: null });
    expect(pulsanteScegli(r)).toHaveLength(0);
  });

  it('agli altri resta com’era', () => {
    expect(doveSiAttivaLAbbonamento(true)).toEqual({ href: PERCORSO_ABBONAMENTO, testo: 'Scegli l’abbonamento dal tuo negozio' });
    expect(doveSiAttivaLAbbonamento(false, true).href).toBe('/sell');
  });
});
