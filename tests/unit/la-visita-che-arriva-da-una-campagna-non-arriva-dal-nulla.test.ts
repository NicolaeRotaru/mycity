import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { indirizzoDaSpedire, chiaveDellaPaginaVista } from '@/lib/analytics/tracciamento';

/**
 * 6/9/2026 — CHI ARRIVAVA DA UN ANNUNCIO PAGATO RISULTAVA ARRIVATO DAL NULLA.
 *
 * L'indirizzo che il sito manda a Google Analytics veniva ricostruito dalla
 * CHIAVE della pagina vista, che della coda dell'indirizzo tiene solo il testo
 * cercato. Così sparivano `utm_source`, `utm_medium`, `utm_campaign` e `gclid`:
 * cioè esattamente i pezzi con cui Google capisce da dove arriva la persona.
 *
 * Chi cliccava un post sponsorizzato e atterrava su
 * «/?utm_source=facebook&utm_campaign=natale» veniva registrato come arrivato
 * su «/» e basta. Il giorno in cui si comincia a spendere in pubblicità, ogni
 * visita comprata finisce sotto «diretto» e il ritorno della spesa non si può
 * leggere: si rischia di spegnere la campagna che funziona e tenere quella che
 * non rende.
 *
 * La causa era una confusione fra due cose diverse: la chiave decide QUANDO
 * mandare la pagina vista, l'indirizzo decide COSA si manda. Adesso le fanno
 * due funzioni separate.
 *
 * ⚠️ E il testo cercato deve restare fuori: nella casella di ricerca la gente
 * scrive la propria email, il numero d'ordine, il telefono. Qui si prova tutte
 * e due le cose insieme, perché è facilissimo riparare la prima rompendo la
 * seconda.
 */

const IN_ARRIVO = 'utm_source=facebook&utm_medium=paid&utm_campaign=natale';

describe('quello che il sito dice a Google su dove ha preso la persona', () => {
  it('i parametri della campagna arrivano interi', () => {
    const uscito = indirizzoDaSpedire('/', new URLSearchParams(IN_ARRIVO));
    const coda = new URLSearchParams(uscito.split('?')[1] ?? '');
    expect(coda.get('utm_source')).toBe('facebook');
    expect(coda.get('utm_medium')).toBe('paid');
    expect(coda.get('utm_campaign')).toBe('natale');
  });

  it("l'identificativo del clic su Google Ads non si perde", () => {
    const uscito = indirizzoDaSpedire('/prodotti/pane', new URLSearchParams('gclid=ABC123'));
    expect(uscito).toContain('gclid=ABC123');
  });

  it('un indirizzo senza coda resta il percorso e basta', () => {
    expect(indirizzoDaSpedire('/negozi', null)).toBe('/negozi');
    expect(indirizzoDaSpedire('/negozi', new URLSearchParams(''))).toBe('/negozi');
  });

  it('i filtri restano fuori: non dicono da dove arriva nessuno', () => {
    const uscito = indirizzoDaSpedire(
      '/search',
      new URLSearchParams(`cat=fiori&prezzo_max=20&ordina=stelle&${IN_ARRIVO}`),
    );
    expect(uscito).not.toContain('cat=');
    expect(uscito).not.toContain('prezzo_max');
    expect(uscito).not.toContain('ordina');
    expect(uscito).toContain('utm_campaign=natale');
  });

  it("quello che la persona ha scritto nella ricerca non esce da questa porta", () => {
    const uscito = indirizzoDaSpedire(
      '/search',
      new URLSearchParams(`q=mario.rossi@gmail.com&${IN_ARRIVO}`),
    );
    expect(uscito, "il testo cercato è tornato dentro l'indirizzo spedito").not.toContain('mario.rossi');
    expect(uscito).not.toContain('q=');
    // La campagna però deve restarci: riparare la privacy non deve rispegnere la misura.
    expect(uscito).toContain('utm_source=facebook');
  });

  it('è un elenco di cose ammesse: un parametro nuovo non esce da solo', () => {
    const uscito = indirizzoDaSpedire(
      '/search',
      new URLSearchParams('cerca_avanzata=via+Roma+12&telefono=3331234567'),
    );
    expect(uscito).toBe('/search');
  });

  it('la chiave resta un altro mestiere: dice quando, non cosa', () => {
    // Due filtri diversi sulla stessa ricerca = la stessa pagina vista.
    const a = chiaveDellaPaginaVista('/search', new URLSearchParams('q=pane&cat=fiori'));
    const b = chiaveDellaPaginaVista('/search', new URLSearchParams('q=pane&cat=vino'));
    expect(a).toBe(b);
  });

  /**
   * Controllo di struttura, dichiarato: in questa repo i componenti React non
   * si montano dentro una prova (`@testing-library/react` non è installata).
   * Qui si guarda che il componente spedisca l'indirizzo giusto e non la chiave.
   */
  it("Google Analytics manda l'indirizzo della campagna, non la chiave", () => {
    const src = readFileSync('components/GoogleAnalytics.tsx', 'utf8');
    expect(src, 'il componente non usa più la funzione che tiene i parametri di campagna')
      .toContain('indirizzoDaSpedire');
    expect(
      src,
      "page_location è tornato a essere costruito dalla chiave: i parametri di campagna si perdono di nuovo",
    ).not.toContain('page_location: window.location.origin + paginaVista');
    // La chiave però deve restare: è lei che impedisce di contare una pagina a ogni filtro.
    expect(src).toContain('chiaveDellaPaginaVista');
  });
});
