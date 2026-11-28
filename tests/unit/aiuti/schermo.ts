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

/**
 * Onda 2 (R07-011) — IL PERMESSO DI RESTARE SOSPESO E' DI OGNI SCHERMO, NON DELL'ULTIMA `accendi`.
 *
 * Prima il permesso era una variabile sola, riscritta da ogni `accendi`: con due schermi accesi
 * valeva quello dell'ultimo per tutti e due. Uno schermo sospeso per sempre SENZA permesso, acceso
 * prima di uno col permesso, passava in silenzio (la prova controllava un'assenza su niente); uno
 * col permesso, acceso prima di uno senza, faceva rigettare `attendi()` a torto. Adesso ogni radice
 * porta il suo permesso, e si contano solo i segnaposto delle radici che non ce l'hanno.
 */
const radiciAccese = new Map<HTMLElement, boolean>();

function sospesiSenzaPermesso(): number {
  let n = 0;
  for (const [radice, permesso] of radiciAccese) {
    if (!permesso && radice.isConnected) n += radice.querySelectorAll(SOSPESO).length;
  }
  return n;
}

/**
 * Onda 2 (R07-011) — UN IMPORT LENTO NON E' UN IMPORT SOSPESO PER SEMPRE.
 *
 * `attendi()` dava venti giri di `setTimeout(0)` (qualche decina di millisecondi) e poi diceva
 * «sospeso per sempre»: un import pigro che la macchina, carica, trasforma in mezzo secondo
 * faceva cadere una prova giusta. Adesso si aspetta a TEMPO, sull'orologio vero (preso qui, prima
 * che una prova accenda l'orologio finto: con l'orologio finto i giri non passerebbero mai).
 */
const ATTESA_MASSIMA_MS = 3000;
const aspettaDavvero = globalThis.setTimeout.bind(globalThis);
const adessoDavvero = Date.now.bind(Date);

function controllaNonSospeso(dove: string) {
  const n = sospesiSenzaPermesso();
  if (n > 0) {
    throw new Error(
      `Lo schermo e' ancora sospeso ${dove} (${n} segnaposto [data-aiuto-sospeso]): il componente non si e' mai disegnato, ` +
        `e una prova che controlla un'assenza passerebbe senza aver provato niente. ` +
        `Se la prova aspetta davvero un componente sospeso, usa accendi(componente, props, { permettiSospeso: true }).`,
    );
  }
}

export function accendi(componente: unknown, proprieta: Record<string, unknown> = {}, opzioni: Opzioni = {}): Schermo {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  radiciAccese.set(radice, opzioni.permettiSospeso === true);
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
    sospeso: () => radice.querySelectorAll(SOSPESO).length,
    smonta: () => {
      void act(() => {
        root.unmount();
      });
      radice.remove();
      radiciAccese.delete(radice);
    },
  };
}

/** Lascia girare gli effetti che aspettavano una promessa (un import pigro, una fetch). */
export async function attendi(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Un import pigro puo' chiedere tempo (la trasformazione del modulo): si aspetta fino a
  // ATTESA_MASSIMA_MS di orologio vero prima di dire che e' sospeso per sempre.
  const scadenza = adessoDavvero() + ATTESA_MASSIMA_MS;
  while (sospesiSenzaPermesso() > 0 && adessoDavvero() < scadenza) {
    await act(async () => {
      await new Promise((ok) => aspettaDavvero(ok, 5));
    });
  }
  controllaNonSospeso('dopo attendi()');
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
