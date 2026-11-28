/**
 * @vitest-environment jsdom
 */
/**
 * 23/11/2026 — Nicola: «è dentro preventivo, ma ogni servizio ha la sua voce dentro il menu»,
 * e il nome del partner «si vedrà solo dentro i servizi offerti ai venditori» (dal 24/11 è SDG Agenzia).
 *
 *  · nel menu del venditore c'è il gruppo «Servizi», con una voce per ogni servizio del listino
 *    (24/11/2026: «Il tuo preventivo» e «Scheda Google» non ci sono più; la sera «Abbonamento» è
 *    sceso in fondo al menu, sotto il nome del negozio, come su Claude);
 *  · dentro un servizio si accende la voce di quel servizio;
 *  · ogni servizio nomina il partner SDG Agenzia; il menu no;
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
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Bar Roma' }, userEmail: 'b@b.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';
import ServizioDelPreventivoPage from '@/app/seller/servizi/[servizio]/page';
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
  it('ha una voce per ogni servizio del listino (24/11: niente più «Il tuo preventivo», e «Abbonamento» sta sotto il nome)', async () => {
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const attesi = SERVIZI_AGENZIA.map((id) => `/seller/servizi/${SLUG_SERVIZIO[id]}`);
    for (const href of attesi) {
      expect(r.querySelector(`a[href="${href}"]`), `manca la voce ${href}`).not.toBeNull();
    }
    expect(r.textContent).toContain('Foto e video');
    // 28/11/2026 — I nomi delle voci come li ha scritti Nicola.
    expect(r.textContent).toContain('Gestione social e Google');
    expect(r.textContent).toContain('Gestione sito web');
    expect(r.textContent).not.toContain('Scheda Google');
    expect(r.textContent).not.toContain('Logo e grafica'); // tolto il 23/11
    expect(r.textContent).not.toContain('Il tuo preventivo');
    const gruppi = Array.from(r.querySelectorAll('*')).filter((n) => n.children.length === 0).map((n) => n.textContent?.trim());
    expect(gruppi).toContain('Servizi');
    expect(gruppi).not.toContain('Preventivo');
    // il menu non nomina il partner: il suo nome sta dentro il servizio
    expect(r.textContent).not.toContain('SDG Agenzia');
  });

  it('dentro un servizio si accende solo la voce di quel servizio', async () => {
    stato.pathname = '/seller/servizi/social';
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const accese = Array.from(r.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(accese).toEqual(['/seller/servizi/social']);
  });

  it('sulla pagina Abbonamento nessuna voce dei servizi si accende: l abbonamento sta sotto il nome', async () => {
    stato.pathname = '/seller/abbonamento';
    const r = await monta(SellerShell, createElement('p', null, 'x'));
    const accese = Array.from(r.querySelectorAll('nav a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(accese).toEqual([]);
    expect(r.querySelector('nav a[href="/seller/abbonamento"]')).toBeNull();
  });
});

describe('la pagina di un servizio', () => {
  it('foto e video nomina il partner SDG Agenzia, mostra il perché e come è compreso nei tre abbonamenti', async () => {
    stato.slug = 'foto-video';
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toContain('I servizi li realizza SDG Agenzia, il partner di MyCity');
    expect(r.textContent).toContain('Nella vetrina non c’è nessun video.');
    // 24/11/2026: il servizio non si vende più da solo, è dentro le tre fasce
    expect(r.textContent).toMatch(/Base · 300,00\s€ al mese/);
    expect(r.textContent).toMatch(/Business · 600,00\s€ al mese/);
    expect(r.textContent).toMatch(/Premium · 900,00\s€ al mese/);
    expect(r.textContent).toContain('Una sessione di foto e video ogni mese.');
    expect(r.textContent).not.toMatch(/da 50,00/);
    expect(r.querySelector('a[href="/seller/abbonamento"]')?.textContent).toContain('Scegli l');
  });

  it('ogni servizio nomina il partner SDG Agenzia, e nessuno nomina più scattiDG', async () => {
    for (const id of SERVIZI_AGENZIA) {
      stato.slug = SLUG_SERVIZIO[id];
      const r = await monta(ServizioDelPreventivoPage);
      expect(r.textContent, `la pagina ${id}`).toContain('SDG Agenzia');
      expect(r.textContent, `la pagina ${id}`).not.toContain('scattiDG');
    }
  });


  it('un servizio che c è già lo dice, senza prezzo né pulsante', async () => {
    stato.slug = 'sito-web';
    stato.preventivo = costruisciPreventivo({
      idAttivita: 'a1b2c3', nomeAttivita: 'Bar Roma', tipoAttivita: 'bar',
      dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: { website: 'https://barroma.it' } },
      impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-23T10:00:00Z'),
    });
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toMatch(/Questo ce l.hai già/);
    expect(r.textContent).not.toContain('Lo voglio');
  });

  it('un indirizzo che non è di nessun servizio non apre una pagina', () => {
    expect(servizioDaSlug('caffe-gratis')).toBeNull();
    expect(servizioDaSlug('logo')).toBeNull(); // tolto dal preventivo il 23/11
    expect(servizioDaSlug('foto-video')).toBe('foto_video');
  });
});

/**
 * 23/11/2026 — Nicola: «inserisci già quel servizio disponibile: dentro il sito una bozza del
 * sito, dentro social manager il piano editoriale del mese (con già degli esempi), dentro
 * foto/video i formati; e togli sezione di logo e grafica».
 */
describe('cosa ricevi, già pronto dentro il servizio', () => {
  it('il sito web mostra la bozza col nome dell attività e un indirizzo suggerito', async () => {
    stato.slug = 'sito-web';
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toContain('La bozza del tuo sito');
    expect(r.textContent).toContain('barroma.it');
    expect(r.querySelector('[aria-label="La bozza del tuo sito"]')?.textContent).toContain('Bar Roma');
    expect(r.textContent).toContain('Chi siamo');
  });

  it('la gestione social mostra il piano di novembre 2026: 12 post, 3 a settimana, con esempi', async () => {
    stato.slug = 'social';
    const r = await monta(ServizioDelPreventivoPage);
    const piano = r.querySelector('[aria-label="Il piano editoriale di novembre 2026"]');
    expect(piano, 'piano editoriale non mostrato').toBeTruthy();
    expect(piano!.querySelectorAll('li')).toHaveLength(12); // mar/gio/sab di novembre 2026
    // 24/11/2026: i 12 esempi sono tutti diversi (prima il 3 era uguale al 17, il 5 al 19…)
    const esempi = [...piano!.querySelectorAll('li')].map((li) => li.textContent);
    expect(new Set(esempi).size).toBe(12);
    expect(piano!.textContent).toContain('Sono esempi');
    expect(piano!.textContent).toContain('Bar Roma');
    expect(piano!.textContent).not.toMatch(/€|%|sconto/i); // nessun prezzo o sconto inventato nei post
  });

  it('foto e video mostra i formati di foto, video ed editing', async () => {
    stato.slug = 'foto-video';
    const r = await monta(ServizioDelPreventivoPage);
    expect(r.textContent).toContain('I formati che ricevi');
    expect(r.textContent).toContain('Reel');
    expect(r.textContent).toContain('verticale 9:16');
    expect(r.textContent).toContain('Foto dei prodotti');
    expect(r.textContent).toContain('Sottotitoli');
  });

  it('la gestione social mostra anche come apparirà la scheda su Maps, col nome e la categoria', async () => {
    stato.slug = 'social';
    const r = await monta(ServizioDelPreventivoPage);
    const scheda = r.querySelector('[aria-label="La tua scheda su Google Maps"]');
    expect(scheda, 'anteprima della scheda non mostrata').toBeTruthy();
    expect(scheda!.textContent).toContain('Bar Roma');
    expect(scheda!.textContent).toContain('Bar · Piacenza');
    expect(scheda!.textContent).toContain('vetrina MyCity');
    expect(r.textContent).toContain('È compreso in tutti e tre gli abbonamenti');
  });

  it('la pagina Abbonamento mostra le tre fasce, parte dal Business consigliato e accetta la fascia scelta', async () => {
    const { default: PaginaAbbonamento } = await import('@/app/seller/abbonamento/page');
    const r = await monta(PaginaAbbonamento);
    const radio = [...r.querySelectorAll<HTMLInputElement>('input[name="abbonamento"]')];
    expect(radio.map((x) => x.value)).toEqual(['base', 'business', 'premium']);
    expect(radio.find((x) => x.checked)?.value).toBe('business'); // vetrina vuota: mancano foto e sito
    expect(r.textContent).toContain('Ti consigliamo il Business.');
    await act(async () => { radio[2].click(); });
    // 26/11/2026: per ora si paga in contanti (lib/agenzia/pagamento-servizi.ts): niente «Paga e attiva»,
    // si chiede di essere contattati per la fascia scelta. Il primo mese a metà resta scritto sulla fascia.
    expect(r.textContent).not.toContain('Paga e attiva');
    expect(r.textContent).toContain('Voglio il Premium: contattatemi');
    expect(r.textContent).toMatch(/Il primo mese 450,00\s€/);
    expect(r.textContent).toContain('I servizi li realizza SDG Agenzia, il partner di MyCity');
    // «Cosa ci guadagni» tolto il 27/11/2026 (Nicola); sotto ogni piano il primo mese e il pareggio in colazioni
    expect(r.textContent).not.toContain('Cosa ci guadagni');
    expect(r.textContent).toMatch(/Il primo mese 300,00\s€/);
    expect(r.textContent).toContain('l’incasso di 7 colazioni in più');
    expect(r.textContent).toContain('disdici quando vuoi, con 30 giorni di preavviso');
    expect(r.textContent).toContain('Ogni mese ti mandiamo il resoconto');
    // il titolare cambia lo scontrino e i conti si rifanno
    const casella = r.querySelector<HTMLInputElement>('#scontrino-medio')!;
    const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { imposta.call(casella, '5'); casella.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(r.textContent).toContain('l’incasso di 4 colazioni in più'); // 500 € / 30 / 5 € = 3,3 → 4
  });

});
