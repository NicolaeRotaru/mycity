/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// Il finto vero che le prove compilate ricevono al posto di next/navigation (tests/unit/aiuti/compila.mjs).
import { useSearchParams, useParams } from './aiuti/finti/next-navigation.mjs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * R10-010 (onda 2, 28/11/2026) — IL FINTO `useSearchParams` CREAVA UN OGGETTO NUOVO A OGNI GIRO.
 *
 * In Next l'oggetto resta lo stesso finché l'indirizzo non cambia. Col finto di prima un effetto
 * legato all'indirizzo (`useEffect(..., [searchParams])`) ripartiva a ogni disegno: le prove montate
 * non potevano vedere le gare sull'indirizzo, perché l'effetto ripartito copriva quello che in Next
 * parte una volta sola.
 */
const g = globalThis as { __QUERY_FINTA__?: string; __PARAMETRI_FINTI__?: unknown };

afterEach(() => {
  delete g.__QUERY_FINTA__;
  delete g.__PARAMETRI_FINTI__;
});

describe('R10-010 · il finto useSearchParams resta lo stesso finché l’indirizzo non cambia', () => {
  it('IL CASO DELLA VOCE — due chiamate con lo stesso indirizzo danno lo stesso oggetto', () => {
    g.__QUERY_FINTA__ = 'q=pane';
    const a = useSearchParams();
    const b = useSearchParams();
    expect(b).toBe(a);
    expect(a.get('q')).toBe('pane');
  });

  it('l’indirizzo cambia: oggetto nuovo, col valore nuovo', () => {
    g.__QUERY_FINTA__ = 'q=pane';
    const a = useSearchParams();
    g.__QUERY_FINTA__ = 'q=latte';
    const b = useSearchParams();
    expect(b).not.toBe(a);
    expect(b.get('q')).toBe('latte');
  });

  it('montato: un effetto legato all’indirizzo parte una volta per indirizzo, non a ogni disegno', () => {
    const giri: string[] = [];
    function Pagina({ n }: { n: number }) {
      const sp = useSearchParams();
      useEffect(() => {
        giri.push(sp.get('q') ?? '');
      }, [sp]);
      return <span>{n}</span>;
    }
    const div = document.createElement('div');
    const root = createRoot(div);
    g.__QUERY_FINTA__ = 'q=pane';
    act(() => root.render(<Pagina n={1} />));
    act(() => root.render(<Pagina n={2} />));
    act(() => root.render(<Pagina n={3} />));
    expect(giri, 'l’effetto riparte a ogni disegno con lo stesso indirizzo').toEqual(['pane']);
    g.__QUERY_FINTA__ = 'q=latte';
    act(() => root.render(<Pagina n={4} />));
    expect(giri).toEqual(['pane', 'latte']);
    act(() => root.unmount());
  });

  it('useParams senza parametri finti resta lo stesso oggetto', () => {
    expect(useParams()).toBe(useParams());
  });
});
