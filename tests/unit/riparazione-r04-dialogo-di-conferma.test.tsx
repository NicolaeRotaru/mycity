/**
 * @vitest-environment jsdom
 *
 * R04-005 (4) — IL DIALOGO DI CONFERMA TIENE IL FUOCO DENTRO E LO RIPORTA INDIETRO.
 * Il dialogo si dichiara modale: Tab e Maiusc+Tab girano fra i suoi bottoni, e alla chiusura il fuoco torna
 * a chi l'ha aperto. Il dialogo vero si disegna e si preme come farebbe chi naviga da tastiera.
 * (Prova a parte: monta solo il dialogo, così non dipende da chi altro importa le sue funzioni.)
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

type Pagina = ComponentType<Record<string, unknown>>;
type Schermo = ReturnType<typeof accendi>;
let Dialogo: { ConfirmDialogHost: Pagina; confirmDialog: (o: { title: string; danger?: boolean }) => Promise<boolean> };
const aperti: Schermo[] = [];

beforeAll(async () => {
  Dialogo = (await monta('components/ConfirmDialog.tsx')) as unknown as typeof Dialogo;
}, 120000);

afterEach(() => {
  while (aperti.length) aperti.pop()!.smonta();
});

describe('il dialogo di conferma tiene il fuoco dentro e lo riporta indietro', () => {
  async function apriIlDialogo() {
    const apri = document.createElement('button');
    apri.textContent = 'Annulla ordine';
    document.body.append(apri);
    const s = accendi(Dialogo.ConfirmDialogHost);
    aperti.push(s);
    apri.focus();
    let esito!: Promise<boolean>;
    await act(async () => {
      esito = Dialogo.confirmDialog({ title: "Annullare l'ordine?", danger: true });
    });
    const bottoni = Array.from(s.radice.querySelectorAll('button'));
    expect(bottoni.length, 'il dialogo non si è aperto con i suoi due bottoni').toBe(2);
    return { apri, bottoni, esito, s };
  }
  const tasto = (el: Element, shift: boolean) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it('Tab sull’ultimo bottone torna al primo', async () => {
    const { apri, bottoni } = await apriIlDialogo();
    bottoni[1].focus();
    const e = tasto(bottoni[1], false);
    expect(e.defaultPrevented, 'col Tab si usciva dal dialogo modale').toBe(true);
    expect(document.activeElement).toBe(bottoni[0]);
    apri.remove();
  });

  it('Maiusc+Tab sul primo bottone va all’ultimo', async () => {
    const { apri, bottoni } = await apriIlDialogo();
    bottoni[0].focus();
    const e = tasto(bottoni[0], true);
    expect(e.defaultPrevented, 'con Maiusc+Tab si usciva dal dialogo modale').toBe(true);
    expect(document.activeElement).toBe(bottoni[1]);
    apri.remove();
  });

  it('Maiusc+Tab sull’ultimo bottone non lo sposta da sé: ci pensa il browser', async () => {
    const { apri, bottoni } = await apriIlDialogo();
    bottoni[1].focus();
    const e = tasto(bottoni[1], true);
    expect(e.defaultPrevented).toBe(false);
    apri.remove();
  });

  it('alla chiusura il fuoco torna a chi ha aperto il dialogo', async () => {
    const { apri, esito } = await apriIlDialogo();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await expect(esito).resolves.toBe(false);
    expect(document.activeElement, 'alla chiusura il fuoco cadeva sul corpo della pagina').toBe(apri);
    apri.remove();
  });
});

