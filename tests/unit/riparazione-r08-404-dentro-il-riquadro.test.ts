import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R08-004 — La 404 a 280 px col testo al 200% (radice 32 px), misurata in Chromium:
 *  · il «404» (120 px, 242 px di testo) stava nella finestra solo perche' il flex lo centrava fuori dal
 *    padding del contenitore (px-6 = 48 px): 19-261 px su un contenitore che va da 48 a 232;
 *  · il riquadro «Link utili» era largo 270 px (da 5 a 275) su un contenitore di 184: la parola piu'
 *    lunga di ogni voce, con l'icona e il padding, non poteva stringersi.
 * Dopo: il numero e' di 70 px (141 px di testo, 70-211) e il riquadro coincide col contenitore (48-232),
 * con le voci che vanno a capo dentro.
 */
const src = readFileSync('app/not-found.tsx', 'utf8');
const classi = (s: string) => s.split(/\s+/).filter(Boolean);

describe('R08-004 — la 404 sta dentro il suo contenitore col testo molto grande', () => {
  it('il numero 404 sotto sm e limitato dalla larghezza (min con vw) e da sm in su cresce come prima', () => {
    const m = src.match(/<p className="([^"]*)">\s*404\s*<\/p>/);
    expect(m, 'il paragrafo «404» non si trova piu').toBeTruthy();
    const c = classi(m![1]);
    expect(c).toContain('text-[length:min(3.75rem,25vw)]');
    expect(c).toContain('sm:text-7xl');
    expect(c).toContain('md:text-9xl');
  });

  it('le voci di «Link utili» possono andare a capo anche dentro una parola, e non sporgono dal riquadro', () => {
    const ul = src.match(/<ul className="([^"]*)">/);
    expect(ul, 'l elenco dei link utili non si trova piu').toBeTruthy();
    const c = classi(ul![1]);
    expect(c).toContain('[overflow-wrap:anywhere]');
    expect(c, 'sopra sm le due colonne restano').toContain('sm:grid-cols-2');
    const voci = [...src.matchAll(/<Link href="[^"]*" className="([^"]*)">/g)].map((m) => classi(m[1]));
    expect(voci.length).toBe(6);
    for (const v of voci) expect(v).toContain('max-w-full');
  });
});
