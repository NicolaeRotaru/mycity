/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R116 e R118) — DUE POSTI DOVE C'ERA UN'INFORMAZIONE A VIDEO E
 * NIENTE DA ASCOLTARE.
 *
 * ① La mappa della consegna in tempo reale era un `<div>` nudo: nessun ruolo,
 * nessun nome, nessuna alternativa scritta. Leaflet ci disegna dentro, e i
 * segnaposti erano forme colorate con dentro la sola INIZIALE dell'etichetta
 * («R» per «Rider Marco»). Chi la apre con un lettore di schermo sentiva una
 * lettera sola, o niente. L'etichetta intera esisteva, ma solo nel cartellino
 * che compare passandoci sopra col mouse — e sul telefono il mouse non c'è.
 *
 * ② Nel visore delle storie le barrette in alto dicono a colpo d'occhio a che
 * punto sei: quante storie ci sono e quale stai guardando. Sono `<div>` vuoti.
 * In tutto il file non esisteva da nessuna parte un «Storia 2 di 5»: chi
 * ascolta non sapeva né quante ne restavano né dove si trovava.
 */

describe('la mappa della consegna in tempo reale', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__SEGNAPOSTI__ = [];
  });

  it('si presenta, e dice a parole chi c\'è sopra', async () => {
    const mod = await monta('components/DeliveryMap.tsx');
    const s = accendi(mod.default, {
      points: [
        { lat: 45.05, lng: 9.69, label: 'Pane Quotidiano', color: 'indigo' },
        { lat: 45.06, lng: 9.7, label: 'Casa tua', color: 'rose' },
      ],
    });
    await attendi();

    const descritta = s.radice.querySelector('[role="img"][aria-label]');
    const alternativa = testoVisibile(s.radice);
    const testo = descritta?.getAttribute('aria-label') ?? alternativa;

    expect(
      testo,
      'La mappa era un riquadro senza nome e senza alternativa scritta: chi non la vede non aveva nulla',
    ).toBeTruthy();
    expect(testo, 'Il nome del negozio deve comparire nell\'alternativa alla mappa').toContain('Pane Quotidiano');
    expect(testo, 'E anche la destinazione').toContain('Casa tua');
    s.smonta();
  }, 60000);

  it('i segnaposti non sono muti: dentro c\'è il nome intero, non la sola iniziale', async () => {
    const mod = await monta('components/DeliveryMap.tsx');
    const s = accendi(mod.default, {
      points: [{ lat: 45.05, lng: 9.69, label: 'Rider Marco', color: 'amber' }],
    });
    await attendi();

    const segnaposti = (globalThis as { __SEGNAPOSTI__?: Array<{ html?: string }> }).__SEGNAPOSTI__ ?? [];
    expect(segnaposti.length, 'Nessun segnaposto è stato disegnato: la prova non sta guardando niente').toBe(1);
    expect(
      segnaposti[0].html,
      'Dentro il segnaposto c\'era solo la lettera «R»: chi ascolta sentiva una lettera e basta',
    ).toContain('Rider Marco');
    s.smonta();
  }, 60000);

  it('il nome di un negozio non può portare dentro del codice', async () => {
    // Il nome del negozio lo scrive il negoziante, e qui finisce dentro una
    // stringa di HTML che Leaflet incolla nella pagina: se passasse così com'è,
    // basterebbe chiamarsi in un certo modo per far girare del codice a casa di
    // chi guarda la mappa.
    const mod = await monta('components/DeliveryMap.tsx');
    const s = accendi(mod.default, {
      points: [{ lat: 45.05, lng: 9.69, label: '<img src=x onerror="rubaTutto()">', color: 'indigo' }],
    });
    await attendi();

    const segnaposti = (globalThis as { __SEGNAPOSTI__?: Array<{ html?: string }> }).__SEGNAPOSTI__ ?? [];
    expect(segnaposti[0]?.html, 'Nessun segnaposto disegnato').toBeTruthy();
    expect(
      segnaposti[0].html,
      'Il nome del negozio è finito dentro il segnaposto come HTML vero, non come testo',
    ).not.toContain('<img');
    expect(segnaposti[0].html, 'Il nome deve restare leggibile, solo disinnescato').toContain('&lt;img');
    s.smonta();
  }, 60000);
});

describe('il visore delle storie', () => {
  const storie = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    image_url: `https://esempio.it/${i}.jpg`,
    caption: null,
    link_url: null,
    seller: { id: 'n1', store_name: 'Pane Quotidiano', store_logo: null },
  }));

  it('dice a che punto sei: «Storia 2 di 5»', async () => {
    const mod = await monta('components/StoryViewer.tsx');
    const s = accendi(mod.default, { stories: storie, startIndex: 1, onClose: () => {} });

    const testo = testoVisibile(s.radice);
    expect(
      testo,
      `Nel visore non c'è da nessuna parte «Storia 2 di 5»: chi ascolta non sa quante ne restano. Testo letto: «${testo}»`,
    ).toMatch(/storia\s*2\s*(di|su)\s*5/i);
    s.smonta();
  }, 60000);
});
