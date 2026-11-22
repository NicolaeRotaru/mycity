/**
 * @vitest-environment jsdom
 */
/**
 * R07-007 — La gara fra la riscrittura dell'indirizzo e il ritorno indietro del pannello.
 *
 * Nella ricerca ogni filtro toccato riscrive l'indirizzo con router.replace. Col pannello aperto
 * c'è una voce di cronologia in più, e chiudendolo il hook fa history.back(). In Next un replace
 * ancora in volo viene scartato dal popstate del ritorno (il ritorno ha la precedenza), e la voce
 * di sotto ha l'indirizzo di prima: l'indirizzo restava senza i filtri scelti, e chi apriva un
 * prodotto e tornava indietro li perdeva.
 *
 * Qui la pagina vera della ricerca, il hook vero e la cronologia vera di jsdom. Il router è finto
 * ma fa come quello di Next: registra l'ordine delle chiamate, un replace resta «in volo» finché la
 * prova non lo conclude, un replace nuovo scarta quello in volo, e il popstate scarta quello in
 * volo e conferma l'indirizzo della voce su cui si atterra.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const next = vi.hoisted(() => ({
  /** L'indirizzo che il router ha confermato: è quello che legge useSearchParams. */
  confermato: '/search?q=pane',
  /** L'ordine di quello che succede: replace chiesti, popstate, replace conclusi. */
  registro: [] as string[],
  inVolo: [] as Array<{ dove: string; scartato: boolean }>,
  iscritti: new Set<() => void>(),
}));

vi.mock('next/navigation', async () => {
  const React = await import('react');
  const router = {
    replace: (dove: string) => {
      next.registro.push(`replace ${dove}`);
      // Come Next: una navigazione nuova scarta quella ancora in corso.
      for (const v of next.inVolo) v.scartato = true;
      next.inVolo.push({ dove, scartato: false });
    },
    push: (dove: string) => { next.registro.push(`push ${dove}`); },
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
  };
  const iscriviti = (f: () => void) => {
    next.iscritti.add(f);
    return () => { next.iscritti.delete(f); };
  };
  return {
    useRouter: () => router,
    usePathname: () => '/search',
    useSearchParams: () => {
      const url = React.useSyncExternalStore(iscriviti, () => next.confermato, () => next.confermato);
      return React.useMemo(() => new URLSearchParams(url.split('?')[1] ?? ''), [url]);
    },
  };
});
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => ({}) } }));
vi.mock('@/components/ProductGrid', () => ({ default: () => null }));
vi.mock('@/components/SponsoredCarousel', () => ({ default: () => null }));

import SearchPage from '@/app/search/page';

const g = globalThis as Record<string, unknown>;
let root: Root | null = null;
let radice: HTMLElement | null = null;

/** Il popstate visto da Next: scarta la navigazione in volo e conferma l'indirizzo della voce. */
function popstateDiNext() {
  next.registro.push(`popstate ${window.location.pathname}${window.location.search}`);
  for (const v of next.inVolo) v.scartato = true;
  next.inVolo = [];
  next.confermato = window.location.pathname + window.location.search;
  for (const f of next.iscritti) f();
}

/** Lascia arrivare i popstate che jsdom manda dopo history.back(), e i giri che seguono. */
async function lascia() {
  await act(async () => {
    await new Promise((fatto) => setTimeout(fatto, 30));
  });
}

/** Conclude i replace in volo: quello non scartato scrive l'indirizzo sulla voce di cronologia di quel momento. */
async function concludi() {
  await act(async () => {
    for (const v of next.inVolo.splice(0)) {
      if (v.scartato) continue;
      window.history.replaceState(window.history.state, '', v.dove);
      next.confermato = v.dove;
      next.registro.push(`concluso ${v.dove}`);
    }
    for (const f of next.iscritti) f();
  });
  await lascia();
}

const clicca = (el: Element) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const pannello = () => radice!.querySelector('[role="dialog"]');
const dentroIlPannello = (testo: string) =>
  Array.from(pannello()?.querySelectorAll('button') ?? []).find((b) => b.textContent === testo);
/** La casella di un filtro, nel pannello del telefono oppure nella colonna del computer. */
const casella = (dove: Element, etichetta: string) =>
  Array.from(dove.querySelectorAll('label')).find((l) => l.textContent === etichetta)?.querySelector('input[type="checkbox"]');
const indirizzo = () => new URLSearchParams(window.location.search);

beforeEach(async () => {
  window.history.replaceState({ dove: 'home' }, '', '/');
  window.history.pushState({ dove: 'pagina' }, '', '/search?q=pane');
  await new Promise((fatto) => setTimeout(fatto, 30));
  next.confermato = '/search?q=pane';
  next.registro = [];
  next.inVolo = [];
  // Next ascolta il popstate da quando parte l'app: prima di qualunque pannello.
  window.addEventListener('popstate', popstateDiNext);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  await act(async () => { root!.render(createElement(SearchPage)); });
  await lascia();
  next.registro = [];
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  radice?.remove();
  root = null;
  radice = null;
  await lascia();
  window.removeEventListener('popstate', popstateDiNext);
});

async function apri(pulsante: 'filters' | 'sortBy') {
  const b = radice!.querySelector(`button[aria-label="${pulsante}"]`);
  expect(b, `manca il pulsante ${pulsante} del telefono`).not.toBeNull();
  await act(async () => { clicca(b!); });
  expect(pannello(), 'il pannello non si è aperto').not.toBeNull();
}

/** Nessuna voce orfana: si è sulla voce della ricerca, e un Indietro solo esce dalla pagina. */
async function cronologiaPulita() {
  expect(window.history.state, 'si è rimasti su una voce che non è quella della ricerca').toEqual({ dove: 'pagina' });
  await act(async () => { window.history.back(); });
  await lascia();
  expect(window.history.state, 'per uscire dalla ricerca serve un Indietro in più').toEqual({ dove: 'home' });
}

describe('R07-007 · chiuso il pannello, l indirizzo ha i filtri scelti', () => {
  it('filtro scelto a pannello aperto, chiuso con «Mostra risultati»: il replace parte dopo il ritorno e resta', async () => {
    await apri('filters');
    await act(async () => { clicca(casella(pannello()!, 'promotion')!); });
    await lascia();
    await act(async () => { clicca(dentroIlPannello('showResults')!); });
    await lascia();
    await concludi();

    expect(pannello()).toBeNull();
    expect(indirizzo().get('promo'), 'chiuso il pannello, l indirizzo ha perso il filtro scelto').toBe('1');
    expect(indirizzo().get('q')).toBe('pane');
    expect(next.registro).toEqual([
      'popstate /search?q=pane',
      'replace /search?q=pane&promo=1',
      'concluso /search?q=pane&promo=1',
    ]);
    await cronologiaPulita();
  });

  it('filtro scelto e pannello chiuso col tasto Indietro del telefono: il filtro resta nell indirizzo', async () => {
    await apri('filters');
    await act(async () => { clicca(casella(pannello()!, 'promotion')!); });
    await lascia();
    await act(async () => { window.history.back(); });
    await lascia();
    await concludi();

    expect(pannello()).toBeNull();
    expect(indirizzo().get('promo'), 'col tasto Indietro l indirizzo ha perso il filtro scelto').toBe('1');
    expect(next.registro).toEqual([
      'popstate /search?q=pane',
      'replace /search?q=pane&promo=1',
      'concluso /search?q=pane&promo=1',
    ]);
    await cronologiaPulita();
  });

  it('due filtri a pannello aperto: un solo replace, dopo il ritorno, con tutti e due', async () => {
    await apri('filters');
    await act(async () => { clicca(casella(pannello()!, 'promotion')!); });
    await act(async () => { clicca(casella(pannello()!, 'inStock')!); });
    await lascia();
    await act(async () => { clicca(dentroIlPannello('showResults')!); });
    await lascia();
    await concludi();

    expect(indirizzo().get('promo')).toBe('1');
    expect(indirizzo().get('disponibili')).toBe('1');
    expect(next.registro).toEqual([
      'popstate /search?q=pane',
      'replace /search?q=pane&promo=1&disponibili=1',
      'concluso /search?q=pane&promo=1&disponibili=1',
    ]);
    await cronologiaPulita();
  });

  it('«Ordina»: scelto un ordinamento, il pannello si toglie dalla cronologia e poi l indirizzo lo tiene', async () => {
    await apri('sortBy');
    await act(async () => { clicca(dentroIlPannello('sort.price_asc')!); });
    await lascia();
    await concludi();

    expect(pannello()).toBeNull();
    expect(indirizzo().get('ordine')).toBe('price_asc');
    expect(next.registro).toEqual([
      'popstate /search?q=pane',
      'replace /search?q=pane&ordine=price_asc',
      'concluso /search?q=pane&ordine=price_asc',
    ]);
    await cronologiaPulita();
  });

  it('senza pannello (la colonna del computer) l indirizzo si riscrive subito, come prima', async () => {
    const colonna = radice!.querySelector('aside');
    expect(colonna, 'manca la colonna dei filtri del computer').not.toBeNull();
    await act(async () => { clicca(casella(colonna!, 'promotion')!); });
    await lascia();
    expect(next.registro).toEqual(['replace /search?q=pane&promo=1']);
    await concludi();
    expect(indirizzo().get('promo')).toBe('1');
    expect(window.history.state).toEqual({ dove: 'pagina' });
  });
});
