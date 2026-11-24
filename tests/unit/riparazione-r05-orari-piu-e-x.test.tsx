/**
 * @vitest-environment jsdom
 *
 * Un negoziante SENZA orari (il sito per ora gli prende ordini a ogni ora) preme «+ orario» su un
 * giorno e poi la X di quella fascia, cioè annulla. L'editor, al primo «+ orario», scrive la
 * settimana intera; togliendo la fascia restavano sette giorni vuoti, che il sito legge «chiuso
 * sempre». Annullare deve riportare a «senza orari», il valore di partenza.
 *
 * Il caso vicino resta com'era: un negozio che gli orari li ha, e toglie l'ultima fascia, ha una
 * settimana scritta tutta chiusa (la regola del 31/10 per le ferie).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import StoreHoursEditor from '@/components/seller/StoreHoursEditor';
import { orariImpostati, type StoreHours } from '@/lib/store-hours';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  box?.remove();
  root = null;
  box = null;
});

/** L'editor come lo usa il modulo del negozio, con lo stato vero; `ultimo()` è l'ultimo valore scritto. */
function apri(iniziale: StoreHours) {
  let ultimo: StoreHours = iniziale;
  function Modulo() {
    const [orari, setOrari] = useState<StoreHours>(iniziale);
    return <StoreHoursEditor value={orari} onChange={(n) => { ultimo = n; setOrari(n); }} />;
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(<Modulo />));
  const riga = (giorno: string) =>
    [...box!.querySelectorAll('span')].find((s) => s.textContent === giorno)!.parentElement as HTMLElement;
  const premi = (b: Element | undefined) => {
    expect(b, 'pulsante non trovato').toBeTruthy();
    act(() => b!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };
  return {
    ultimo: () => ultimo,
    piuOrario: (giorno: string) => premi([...riga(giorno).querySelectorAll('button')].find((b) => b.textContent?.includes('orario'))),
    togliFascia: (giorno: string) => premi(riga(giorno).querySelector('button[aria-label="Rimuovi orario"]') ?? undefined),
    avvisoSenzaOrari: () => !!box!.querySelector('p[role="note"]'),
  };
}

describe('«+ orario» e poi la X, da un negozio senza orari', () => {
  it('torna a «senza orari», non a sette giorni chiusi', () => {
    const e = apri({});
    expect(e.avvisoSenzaOrari()).toBe(true);
    e.piuOrario('Lunedì');
    expect(orariImpostati(e.ultimo())).not.toBeNull();
    e.togliFascia('Lunedì');
    expect(orariImpostati(e.ultimo()), 'annullato «+ orario», il negozio risulta chiuso sempre').toBeNull();
    expect(e.ultimo()).toEqual({});
    expect(e.avvisoSenzaOrari()).toBe(true);
  });

  it('due giorni aggiunti e tolti uno alla volta: solo togliendo l\'ultimo si torna a «senza orari»', () => {
    const e = apri({});
    e.piuOrario('Lunedì');
    e.piuOrario('Martedì');
    e.togliFascia('Lunedì');
    expect(e.ultimo().tue).toHaveLength(1);
    expect(e.ultimo().mon).toEqual([]);
    e.togliFascia('Martedì');
    expect(orariImpostati(e.ultimo())).toBeNull();
  });

  it('un negozio che gli orari li ha e toglie l\'ultima fascia: settimana chiusa, come prima', () => {
    const e = apri({ mon: [['09:00', '13:00']] });
    e.togliFascia('Lunedì');
    expect(e.ultimo()).toEqual({ sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] });
    expect(orariImpostati(e.ultimo())).not.toBeNull();
  });
});
