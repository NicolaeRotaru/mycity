/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { accendi } from './aiuti/schermo';
import VideoSection from '@/components/store-sections/VideoSection';

/**
 * R18-008 (la parte della vetrina) — Il video di YouTube o Vimeo nella vetrina del negozio non
 * deve caricarsi senza che il visitatore lo chieda: niente iframe prima del tocco, e il pulsante
 * dice da dove arriva il video. Dopo il tocco l'iframe nasce, col dominio senza cookie di YouTube
 * o col «do not track» di Vimeo.
 *
 * La vetrina lo fa già (VideoSection passa da VideoAlClic, 5/11/2026): questa prova lo tiene
 * fermo col clic vero. Restano la cookie policy e l'informativa, che non nominano YouTube e Vimeo.
 */

const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' } } as never;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('R18-008 — il video della vetrina si carica solo al tocco', () => {
  it.each([
    ['youtube', 'YouTube', 'youtube-nocookie.com/embed/abc123'],
    ['vimeo', 'Vimeo', 'player.vimeo.com/video/987?dnt=1'],
  ])('%s: niente iframe prima del clic, e il clic dice che il video arriva da %s', (provider, nome, indirizzo) => {
    const s = accendi(VideoSection, { ctx, config: { heading: 'Il forno', provider, videoId: provider === 'youtube' ? 'abc123' : '987' } });
    expect(s.radice.querySelectorAll('iframe'), 'il video si carica senza che nessuno lo chieda').toHaveLength(0);
    const bottone = s.radice.querySelector('button') as HTMLButtonElement;
    expect(bottone.textContent).toContain(`Guarda il video (${nome})`);
    expect(bottone.textContent).toContain(`si carica da ${nome}`);
    s.agisci(() => bottone.click());
    const iframe = s.radice.querySelector('iframe');
    expect(iframe, 'dopo il tocco il video non parte').toBeTruthy();
    expect(iframe!.getAttribute('src')).toContain(indirizzo);
    s.smonta();
  });
});
