import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fondoDellaBarra, SAFE_AREA_IN_FONDO } from '@/lib/ui/barra-in-fondo';

/**
 * 27/8/2026 (R096) — LA SAFE-AREA DELL'IPHONE CONTATA DUE VOLTE.
 *
 * Le due barre che chiudono un acquisto — «Conferma ordine» in cassa e
 * «Aggiungi al carrello» sulla scheda prodotto — mettevano
 * `env(safe-area-inset-bottom)` sia dentro `bottom` sia nel padding
 * (`pb-safe`, oppure `pb-[calc(0.75rem+env(...))]`). Sull'iPhone con barra
 * gestuale sono ~34 pixel contati due volte: la barra galleggia staccata dal
 * fondo, con una fascia vuota sotto il pulsante.
 *
 * Adesso la misura ha una casa sola, `fondoDellaBarra`.
 */

describe('il fondo di una barra incollata in basso', () => {
  it('mette la misura dell iPhone una volta sola, qualunque cosa ci sia sotto', () => {
    const conTuttoSotto = fondoDellaBarra(['var(--tabbar-height)', 'var(--altezza-banner-cookie, 0px)']);
    const quante = conTuttoSotto.split('env(safe-area-inset-bottom').length - 1;
    expect(quante, 'la misura della barra gestuale compare piu di una volta nello stesso calcolo').toBe(1);
    expect(conTuttoSotto).toBe(
      'calc(env(safe-area-inset-bottom, 0px) + var(--tabbar-height) + var(--altezza-banner-cookie, 0px))',
    );
  });

  it('senza niente sotto resta la sola safe-area', () => {
    expect(fondoDellaBarra()).toBe(`calc(${SAFE_AREA_IN_FONDO})`);
    expect(fondoDellaBarra([''])).toBe(`calc(${SAFE_AREA_IN_FONDO})`);
  });
});

/**
 * La guardia strutturale: la parte che si puo' solo LEGGERE, perche' vive in
 * una classe CSS e in uno `style` dentro due componenti che una prova unitaria
 * non monta. Dice una cosa sola, e la dice bene: quella misura, in ognuna delle
 * due barre, deve comparire una volta.
 */
describe('le due barre dell acquisto', () => {
  const barre = [
    ['app/checkout/page.tsx', 'la barra «Conferma ordine»'],
    ['components/StickyAddToCart.tsx', 'la barra «Aggiungi al carrello»'],
  ] as const;

  it('non ripetono la safe-area nel padding', () => {
    for (const [file, nome] of barre) {
      const testo = readFileSync(file, 'utf8');
      const quante = testo.split('env(safe-area-inset-bottom').length - 1;
      expect(quante, `${nome} conta la safe-area piu di una volta: sotto il pulsante resta una fascia vuota`).toBe(0);
      expect(testo, `${nome} non usa piu la funzione che tiene la misura in un posto solo`).toContain('fondoDellaBarra(');
    }
  });

  it('e non usano la classe pb-safe, che aggiunge la stessa misura nel padding', () => {
    const sticky = readFileSync('components/StickyAddToCart.tsx', 'utf8');
    // Nel commento la parola c'e' ed e' giusto che ci sia: e' la storia. Qui si
    // cerca la classe applicata davvero, dentro un `className`.
    const dentroLeClassi = Array.from(sticky.matchAll(/className="([^"]*)"/g)).map((m) => m[1]);
    for (const classi of dentroLeClassi) {
      expect(classi, 'la barra rimette il padding della safe-area sopra al bottom').not.toContain('pb-safe');
    }
  });
});
