/**
 * R27-013 — Nella scheda «anteprima negozio» dell'hero la miniatura del prodotto restava un
 * riquadro bianco se la foto era stata cancellata. Adesso passa da FotoConRipiego (che dopo
 * l'errore di caricamento mostra /foto-mancante.svg: lo prova già
 * riparazione-r24-foto-che-non-risponde). La copertina del negozio resta <Image>: non è la foto
 * di un prodotto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/home/HeroStoreCard.tsx'), 'utf8');

describe('R27-013 — HeroStoreCard', () => {
  it('la miniatura del prodotto passa da FotoConRipiego', () => {
    expect(src).toMatch(/import FotoConRipiego from '@\/components\/ui\/FotoConRipiego'/);
    expect(src).toMatch(/<FotoConRipiego src=\{sizedImage\(img, 'thumb'\)\}/);
    expect(src).not.toMatch(/<Image src=\{sizedImage\(img, 'thumb'\)\}/);
  });
  it('la copertina del negozio resta un\'<Image>', () => {
    expect(src).toMatch(/<Image src=\{sizedImage\(cover, 'hero'\)\}/);
  });
});
