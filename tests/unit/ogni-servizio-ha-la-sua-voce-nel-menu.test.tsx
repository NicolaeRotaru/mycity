/**
 * @vitest-environment jsdom
 */
/**
 * 23/11/2026 — Nicola: «è dentro preventivo, ma ogni servizio ha la sua voce dentro il menu»,
 * e il nome di scattiDG «si vedrà solo dentro i servizi offerti ai venditori».
 *
 *  · nel menu del venditore c'è il gruppo «Preventivo», con il preventivo intero e una voce per
 *    ogni servizio del listino;
 *  · dentro un servizio si accende la voce di quel servizio, non anche «Il tuo preventivo»;
 *  · la pagina di foto e video nomina scattiDG, quelle degli altri servizi no;
 *  · un indirizzo che non è di nessun servizio non apre una pagina vuota.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SERVIZI_AGENZIA, SLUG_SERVIZIO, servizioDaSlug, type Preventivo } from '@/lib/agenzia/preventivo';

const stato = vi.hoisted(() => ({
  pathname: '/seller/dashboard',
  slug: 'foto-video',
  preventivo: null as unknown,
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
  useQuery: (o: { queryKey: readonly unknown[] }) =>
    o.queryKey[1] === 'preventivo-agenzia'
      ? { data: stato.preventivo, isLoading: false, isError: false, refetch: () => undefined }
      : { data: 0 },
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Bar Roma' }, userEmail: 'b@b.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';
import ServizioDelPreventivoPage from '@/app/seller/preventivo/[servizio]/page';
import { costruisciPreventivo, leggiImpostazioniAgenzia } from '@/lib/agenzia/preventivo';

const accesi: Root[] = [];
async function monta(componente: unknown, figli?: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(componente as never, null, figli as never)); });
  return radice;
}

beforeEach(() => {
  stato.pathname = '/seller/dashboard';
  stato.slug = 'foto-video';
  // Una vetrina vuota: mancano tutti e quattro i servizi.
  stato.preventivo = costruisciPreventivo({
    idAttivita: 'a1b2c3', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar',
    dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: null },
    impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-23T10:00:00Z'),
  }) satisfies Preventivo;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('il menu del venditore', () => {
  it('ha il preventivo intero e una voce per ogni servizio del listino', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const attesi = ['/seller/preventivo', ...SERVIZI_AGENZIA.map((id) => `/seller/preventivo/${SLUG_SERVIZIO[id]}`)];
    for (const href of attesi) {
      expect(r.querySelector(`a[href="${href}"]`), `manca la voce ${href}`).not.toBeNull();
    }
    expect(r.textContent).toContain('Foto e video');
    expect(r.textContent).toContain('Gestione social');
    expect(r.textContent).toContain('Sito web');
    expect(r.textContent).toContain('Logo e grafica');
    // il menu non nomina il partner: il suo nome sta dentro il servizio
    expect(r.textContent).not.toContain('scattiDG');
  });

  it('dentro un servizio si accende solo la voce di quel servizio', async () => {
    stato.pathname = '/seller/preventivo/social';
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const accese = Array.from(r.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(accese).toContain('/seller/preventivo/social');
    expect(accese).not.toContain('/seller/preventivo');
  });

  it('sulla pagina del preventivo intero si accende «Il tuo preventivo»', async () => {
    stato.pathname = '/seller/preventivo';
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const accese = Array.from(r.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(accese).toContain('/seller/preventivo');
  });
});

describe('la pagina di un servizio', () => {
  it('foto e video nomina scattiDG, e mostra prezzo e perché', async () => {
    stato.slug = 'foto-video';
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toContain('scattiDG');
    expect(r.textContent).toMatch(/da 50,00\s€ a 300,00\s€ al mese/);
    expect(r.textContent).toContain('Nella vetrina non c’è nessun video.');
    expect(r.textContent).toContain('Lo voglio: contattatemi');
  });

  it('gli altri servizi non nominano scattiDG', async () => {
    for (const id of SERVIZI_AGENZIA.filter((x) => x !== 'foto_video')) {
      stato.slug = SLUG_SERVIZIO[id];
      const r = await monta(ServizioDelPreventivoPage);
      expect(r.textContent, `la pagina ${id} nomina scattiDG`).not.toContain('scattiDG');
    }
  });

  it('un servizio che c è già lo dice, senza prezzo né pulsante', async () => {
    stato.slug = 'logo';
    stato.preventivo = costruisciPreventivo({
      idAttivita: 'a1b2c3', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar',
      dati: { storeLogo: 'https://esempio.it/logo.png', storeMedia: [], prodotti: [], socials: null },
      impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-23T10:00:00Z'),
    });
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toMatch(/Questo ce l.hai già/);
    expect(r.textContent).not.toContain('Lo voglio');
  });

  it('un indirizzo che non è di nessun servizio non apre una pagina', () => {
    expect(servizioDaSlug('caffe-gratis')).toBeNull();
    expect(servizioDaSlug('foto-video')).toBe('foto_video');
  });
});
