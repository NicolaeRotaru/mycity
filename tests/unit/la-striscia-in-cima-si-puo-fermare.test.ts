/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 30/8/2026 (R111) — LA STRISCIA IN CIMA SCORREVA DA SOLA E SUL TELEFONO NON
 * SI POTEVA FERMARE.
 *
 * È contenuto in movimento che parte da solo, dura più di cinque secondi e sta
 * accanto ad altro contenuto: le linee guida di accessibilità (WCAG 2.2.2,
 * livello A) chiedono che ci sia un modo per fermarlo. Gli unici modi previsti
 * erano nel foglio di stile: `:hover`, `:focus-within`, `:active`.
 *
 *  · il passaggio del mouse su un telefono non esiste;
 *  · `:active` dura finché tieni il dito premuto — non è un comando;
 *  · `:focus-within` funziona solo se dentro c'è qualcosa che prende il fuoco,
 *    cioè il link «Promozioni attive», che compare soltanto quando ci sono
 *    promozioni attive E il collegamento è acceso dal branding.
 *
 * Nel caso normale, su un telefono, non c'era nessun modo di fermarla. E la
 * striscia sta dentro la barra in alto, cioè su ogni pagina del sito.
 *
 * Questa prova monta il componente vero, cerca il comando come lo cercherebbe
 * un lettore di schermo, lo preme, e guarda se la striscia si ferma davvero.
 */

describe('la striscia degli annunci in cima al sito', () => {
  it('ha un comando per fermarla, e lo si trova ad occhi chiusi', async () => {
    const mod = await monta('components/PromoTicker.tsx');
    const s = accendi(mod.default, {});

    const comandi = Array.from(s.radice.querySelectorAll('button'));
    const pausa = comandi.find((b) => /pausa|ferma/i.test(nomeAccessibile(b)));

    expect(
      pausa,
      'la striscia scorre da sola e non c e nessun modo di fermarla: su un telefono non esiste il passaggio del mouse',
    ).toBeTruthy();
    s.smonta();
  });

  it('premendolo la striscia si ferma davvero, e ripremendolo riparte', async () => {
    const mod = await monta('components/PromoTicker.tsx');
    const s = accendi(mod.default, {});

    const striscia = s.radice.querySelector('[data-striscia]') as HTMLElement;
    const pausa = Array.from(s.radice.querySelectorAll('button'))
      .find((b) => /pausa|ferma/i.test(nomeAccessibile(b))) as HTMLElement;

    expect(striscia.style.animationPlayState, 'nasce gia ferma: allora non scorre').not.toBe('paused');

    s.agisci(() => clicca(pausa));
    expect(
      striscia.style.animationPlayState,
      'il comando c e ma non ferma niente: il testo continua a scorrere',
    ).toBe('paused');

    s.agisci(() => clicca(pausa));
    expect(striscia.style.animationPlayState, 'una volta fermata non riparte piu').not.toBe('paused');
    s.smonta();
  });

  it('dice anche a chi ascolta se in questo momento e ferma o no', async () => {
    const mod = await monta('components/PromoTicker.tsx');
    const s = accendi(mod.default, {});
    const pausa = Array.from(s.radice.querySelectorAll('button'))
      .find((b) => /pausa|ferma/i.test(nomeAccessibile(b))) as HTMLElement;

    expect(pausa.getAttribute('aria-pressed'), 'lo stato del comando non e dichiarato').toBe('false');
    s.agisci(() => clicca(pausa));
    expect(pausa.getAttribute('aria-pressed')).toBe('true');
    expect(nomeAccessibile(pausa)).toMatch(/riprendi/i);
    s.smonta();
  });
});
