/**
 * Un piccolo schermo finto per le prove: monta il componente DAVVERO, con gli
 * stati e gli effetti, e lascia premere tasti e pulsanti come farebbe una
 * persona. Serve per i difetti che si vedono solo interagendo — un pannello che
 * si apre, il tasto Esc che non chiude, il fuoco che non torna indietro.
 */
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Schermo = {
  doc: Document;
  radice: HTMLElement;
  agisci: (azione: () => void) => void;
  smonta: () => void;
};

export function accendi(componente: unknown, proprieta: Record<string, unknown> = {}): Schermo {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  let root: Root;
  void act(() => {
    root = createRoot(radice);
    root.render(createElement(componente as ComponentType<Record<string, unknown>>, proprieta));
  });
  return {
    doc: document,
    radice,
    agisci: (azione: () => void) => {
      void act(() => {
        azione();
      });
    },
    smonta: () => {
      void act(() => {
        root.unmount();
      });
      radice.remove();
    },
  };
}

/** Lascia girare gli effetti che aspettavano una promessa (un import pigro, una fetch). */
export async function attendi(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Un clic vero, quello che fa partire onClick di React. */
export function clicca(el: Element) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Un tasto premuto sul documento, come lo preme chi naviga da tastiera. */
export function premi(tasto: string, bersaglio: EventTarget = document) {
  bersaglio.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: tasto, bubbles: true, cancelable: true }),
  );
}
