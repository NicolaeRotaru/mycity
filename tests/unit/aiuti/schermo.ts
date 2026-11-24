/**
 * Un piccolo schermo finto per le prove: monta il componente DAVVERO, con gli
 * stati e gli effetti, e lascia premere tasti e pulsanti come farebbe una
 * persona. Serve per i difetti che si vedono solo interagendo — un pannello che
 * si apre, il tasto Esc che non chiude, il fuoco che non torna indietro.
 */
import { act, createElement, Suspense, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Schermo = {
  doc: Document;
  radice: HTMLElement;
  agisci: (azione: () => void) => void;
  smonta: () => void;
  /** Quanti segnaposto di «sospeso» ci sono ora sullo schermo (0 = il componente si è disegnato). */
  sospeso: () => number;
};

/** Il segno che il componente è ancora sospeso (un import pigro, una promessa che non torna). */
const SOSPESO = '[data-aiuto-sospeso]';

type Opzioni = { permettiSospeso?: boolean };
let permettiSospesoDaAccendi = false;

function controllaNonSospeso(doc: Document, dove: string) {
  const n = doc.querySelectorAll(SOSPESO).length;
  if (n > 0 && !permettiSospesoDaAccendi) {
    throw new Error(
      `Lo schermo e' ancora sospeso ${dove} (${n} segnaposto [data-aiuto-sospeso]): il componente non si e' mai disegnato, ` +
        `e una prova che controlla un'assenza passerebbe senza aver provato niente. ` +
        `Se la prova aspetta davvero un componente sospeso, usa accendi(componente, props, { permettiSospeso: true }).`,
    );
  }
}

export function accendi(componente: unknown, proprieta: Record<string, unknown> = {}, opzioni: Opzioni = {}): Schermo {
  permettiSospesoDaAccendi = opzioni.permettiSospeso === true;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  let root: Root;
  void act(() => {
    root = createRoot(radice);
    root.render(createElement(Suspense, { fallback: createElement('span', { 'data-aiuto-sospeso': '' }) }, createElement(componente as ComponentType<Record<string, unknown>>, proprieta)));
  });
  return {
    doc: document,
    radice,
    agisci: (azione: () => void) => {
      void act(() => {
        azione();
      });
    },
    sospeso: () => document.querySelectorAll(SOSPESO).length,
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
  // Un import pigro puo' chiedere qualche giro in piu': si da' un po' di tempo prima di dire che e' sospeso per sempre.
  for (let giro = 0; giro < 20 && document.querySelector(SOSPESO); giro++) {
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 0));
    });
  }
  controllaNonSospeso(document, 'dopo attendi()');
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
