/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, clicca, premi } from './aiuti/schermo';

/**
 * 27/8/2026 (R106 e R113) — DUE PANNELLI DELLA BARRA IN ALTO, DUE MODI DI
 * LASCIARE A PIEDI CHI NON USA IL MOUSE.
 *
 * ① Il mega-menu «Tutte le categorie» si dichiarava un menu (`role="menu"`, e
 * il pulsante `aria-haspopup="menu"`) ma dentro non aveva nemmeno una voce di
 * menu: solo link normali. Un lettore di schermo annunciava «menu», la persona
 * premeva le frecce e non succedeva niente; alcuni lettori, dentro un
 * `role="menu"`, arrivano a nascondere tutto ciò che non è una voce di menu —
 * cioè l'intero contenuto. Un'ARIA sbagliata fa più danno di nessuna ARIA. In
 * più, premendo Esc il pannello si chiudeva ma il fuoco cadeva sul corpo della
 * pagina: chi naviga da tastiera ripartiva dall'inizio del sito.
 *
 * ② La pillola «Consegna a Piacenza» apriva un pannello senza dire di aprirlo
 * (né `aria-expanded` né `aria-haspopup`) e senza nessun modo di uscirne da
 * tastiera: nel file non esisteva un solo gestore di tasti. Si chiudeva solo
 * col mouse, cliccando fuori.
 *
 * Qui i due componenti vengono montati per davvero: si preme, si guarda cosa
 * dicono, si preme Esc e si controlla dov'è finito il fuoco.
 */

describe('il mega-menu delle categorie', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [
      { id: 'a', slug: 'gastronomia', name: 'Gastronomia', parent_id: null, icon: null },
      { id: 'b', slug: 'pane', name: 'Pane', parent_id: 'a', icon: null },
    ];
  });

  it('non si dichiara un menu quando dentro ha soltanto link', async () => {
    const mod = await monta('components/CategoryBar.tsx');
    const s = accendi(mod.default, {});
    const apri = s.radice.querySelector('button')!;

    expect(
      apri.getAttribute('aria-haspopup'),
      'Il pulsante prometteva un menu con le frecce, che non è mai esistito',
    ).not.toBe('menu');

    s.agisci(() => clicca(apri));
    const finto = s.radice.querySelector('[role="menu"]');
    const voci = s.radice.querySelectorAll('[role="menuitem"]').length;
    expect(
      finto && voci === 0,
      'Il pannello si dichiara un menu ma non ha nemmeno una voce di menu: alcuni lettori di schermo ne nascondono il contenuto',
    ).toBeFalsy();
    s.smonta();
  }, 60000);

  it('premendo Esc il fuoco torna sul pulsante che l\'aveva aperto', async () => {
    const mod = await monta('components/CategoryBar.tsx');
    const s = accendi(mod.default, {});
    const apri = s.radice.querySelector('button') as HTMLButtonElement;

    s.agisci(() => {
      apri.focus();
      clicca(apri);
    });
    expect(s.radice.textContent, 'Il pannello doveva aprirsi').toContain('Tutti i prodotti');

    s.agisci(() => premi('Escape'));
    expect(s.radice.textContent, 'Esc doveva chiudere il pannello').not.toContain('Tutti i prodotti');
    expect(
      document.activeElement,
      'Chiuso il pannello, chi naviga da tastiera ripartiva dall\'inizio della pagina invece che dal pulsante',
    ).toBe(apri);
    s.smonta();
  }, 60000);
});

describe('la pillola dell\'indirizzo di consegna', () => {
  it('dice che apre un pannello, e dice quando è aperto', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    const pillola = s.radice.querySelector('button') as HTMLButtonElement;

    expect(
      pillola.getAttribute('aria-expanded'),
      'La pillola apriva un pannello senza dirlo: chi ascolta sentiva solo un pulsante',
    ).toBe('false');
    expect(
      pillola.getAttribute('aria-haspopup'),
      'La pillola deve dichiarare che cosa apre',
    ).toBeTruthy();

    s.agisci(() => clicca(pillola));
    expect(
      s.radice.querySelector('button')!.getAttribute('aria-expanded'),
      'Aperto il pannello, la pillola deve dichiararsi aperta',
    ).toBe('true');
    s.smonta();
  }, 60000);

  it('si chiude con Esc e riporta il fuoco sulla pillola', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    const pillola = s.radice.querySelector('button') as HTMLButtonElement;

    s.agisci(() => {
      pillola.focus();
      clicca(pillola);
    });
    expect(s.radice.textContent, 'Il pannello doveva aprirsi').toContain('Dove vuoi ricevere');

    s.agisci(() => premi('Escape'));
    expect(
      s.radice.textContent,
      'Da tastiera non c\'era nessun modo di chiudere il pannello: si poteva solo cliccare fuori col mouse',
    ).not.toContain('Dove vuoi ricevere');
    expect(
      document.activeElement,
      'Chiuso il pannello il fuoco deve tornare sulla pillola, non cadere sul corpo della pagina',
    ).toBe(s.radice.querySelector('button'));
    s.smonta();
  }, 60000);

  it('il pannello ha un nome, così chi lo apre sa dov\'è finito', async () => {
    const mod = await monta('components/LocationPill.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => clicca(s.radice.querySelector('button')!));
    const pannello = s.radice.querySelector('[role="dialog"]');
    expect(pannello, 'Il pannello dell\'indirizzo non si presenta come un pannello').toBeTruthy();
    expect(
      nomeAccessibile(pannello!) || pannello!.getAttribute('aria-label'),
      'Un pannello senza nome è un posto dove ci si ritrova senza sapere come',
    ).toBeTruthy();
    s.smonta();
  }, 60000);
});
