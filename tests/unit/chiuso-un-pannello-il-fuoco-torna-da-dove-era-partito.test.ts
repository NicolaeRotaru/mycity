/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createElement, useState, type ComponentType } from 'react';
import { monta, nomeAccessibile, controlli } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 27/8/2026 (R112) — TRE PANNELLI CHE PROMETTEVANO DI RIPORTARE IL FUOCO E NON
 * LO RIPORTAVANO MAI.
 *
 * L'aggancio condiviso `useBottomSheetA11y` fa la cosa giusta: alla chiusura
 * chiama `trigger?.focus()`. Solo che tre pannelli — il menu account del
 * telefono, la finestra dell'assistenza e il tour di benvenuto — gli passavano
 * un riferimento creato e mai attaccato a nessun elemento:
 *
 *     const nessunAvvio = useRef<HTMLButtonElement>(null);
 *
 * Quel riferimento resta vuoto per sempre, quindi la chiamata non fa niente e
 * alla chiusura il fuoco cade sul corpo della pagina. Chi naviga da tastiera
 * chiudeva il pannello e si ritrovava all'inizio del sito, dovendo ripercorrere
 * tutta la barra in alto per tornare dov'era. I commenti nel codice dicevano
 * l'opposto: «ritorno del fuoco alla chiusura». Esc e la trappola del fuoco
 * funzionavano davvero; il ritorno no.
 *
 * Qui i pannelli vengono aperti da un pulsante vero e poi chiusi, e si guarda
 * dove è finito il fuoco.
 */

/** Un pulsante che apre il pannello, come succede nella pagina vera. */
function conPulsante(Pannello: ComponentType<Record<string, unknown>>, proprieta: Record<string, unknown> = {}) {
  return function Prova() {
    const [aperto, setAperto] = useState(false);
    return createElement(
      'div',
      null,
      createElement('button', { type: 'button', id: 'avvia', onClick: () => setAperto(true) }, 'Apri il pannello'),
      createElement(Pannello, { ...proprieta, open: aperto, onClose: () => setAperto(false) }),
    );
  };
}

describe('il menu account del telefono', () => {
  it('chiuso, riporta il fuoco sul pulsante che l\'aveva aperto', async () => {
    const mod = await monta('components/MobileAccountSheet.tsx');
    const s = accendi(
      conPulsante(mod.default as ComponentType<Record<string, unknown>>, {
        role: 'buyer',
        displayName: 'Nicola',
        onSignOut: () => {},
      }),
    );
    const avvia = s.radice.querySelector('#avvia') as HTMLButtonElement;

    s.agisci(() => {
      avvia.focus();
      clicca(avvia);
    });
    expect(s.radice.textContent, 'Il menu account doveva aprirsi').toContain('Nicola');

    const chiudi = controlli(s.radice).find((c) => nomeAccessibile(c).toLowerCase().includes('chiudi'))!;
    expect(chiudi, 'Il menu account non ha un comando per chiudersi').toBeTruthy();
    // Come in un browser vero: si arriva sul comando di chiusura, e quindi il
    // fuoco è DENTRO il pannello quando il pannello sparisce.
    s.agisci(() => (chiudi as HTMLElement).focus());
    s.agisci(() => clicca(chiudi));

    expect(
      document.activeElement,
      'Chiuso il menu, chi naviga da tastiera ripartiva dal corpo della pagina invece che dal pulsante «Tu»',
    ).toBe(avvia);
    s.smonta();
  }, 60000);
});

describe('la finestra dell\'assistenza', () => {
  it('chiusa, riporta il fuoco sul pulsante che l\'aveva aperta', async () => {
    const mod = await monta('components/SupportChatModal.tsx');
    const s = accendi(
      conPulsante(mod.default as ComponentType<Record<string, unknown>>, { role: 'buyer' }),
    );
    const avvia = s.radice.querySelector('#avvia') as HTMLButtonElement;

    s.agisci(() => {
      avvia.focus();
      clicca(avvia);
    });
    expect(s.radice.textContent, 'La finestra dell\'assistenza doveva aprirsi').toContain('Assistenza');

    const chiudi = controlli(s.radice).find((c) => nomeAccessibile(c).toLowerCase().includes('chiudi'))!;
    expect(chiudi, 'La finestra dell\'assistenza non ha un comando per chiudersi').toBeTruthy();
    s.agisci(() => (chiudi as HTMLElement).focus());
    s.agisci(() => clicca(chiudi));

    expect(
      document.activeElement,
      'Chiusa l\'assistenza, il fuoco cadeva sul corpo della pagina',
    ).toBe(avvia);
    s.smonta();
  }, 60000);
});

describe('il tour di benvenuto', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__PROFILO__ = { isAuthenticated: true, isBuyer: true };
    (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/';
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('chiuso, riporta il fuoco dove stava la persona prima che si aprisse', async () => {
    const mod = await monta('components/BuyerOnboardingTour.tsx');

    // Un pulsante qualunque della pagina: è lì che stava il fuoco quando il
    // tour è comparso da solo, un secondo e mezzo dopo l'apertura della pagina.
    const Prova = () =>
      createElement(
        'div',
        null,
        createElement('button', { type: 'button', id: 'stavo-qui' }, 'Stavo qui'),
        createElement(mod.default as ComponentType<Record<string, unknown>>, {}),
      );

    const s = accendi(Prova);
    const stavoQui = s.radice.querySelector('#stavo-qui') as HTMLButtonElement;
    s.agisci(() => stavoQui.focus());
    s.agisci(() => vi.advanceTimersByTime(2000));

    expect(s.radice.textContent, 'Il tour di benvenuto doveva comparire').toContain('Benvenuto');

    const chiudi = controlli(s.radice).find((c) => nomeAccessibile(c).toLowerCase().includes('chiudi'))!;
    expect(chiudi, 'Il tour non ha un comando per chiudersi').toBeTruthy();
    s.agisci(() => (chiudi as HTMLElement).focus());
    s.agisci(() => clicca(chiudi));

    expect(
      document.activeElement,
      'Chiuso il tour, il fuoco spariva: la persona ripartiva dall\'inizio della pagina',
    ).toBe(stavoQui);
    s.smonta();
  }, 60000);
});
