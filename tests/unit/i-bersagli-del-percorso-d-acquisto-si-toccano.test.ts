/**
 * 27/8/2026 (R098) — SUL PERCORSO D'ACQUISTO C'ERANO BERSAGLI DA TOCCARE SOTTO I 44 PIXEL.
 *
 * Quarantaquattro pixel è il minimo raccomandato da WCAG 2.5.8 e dalle linee guida di Apple e
 * Google: sotto quella misura, chi ha le mani grandi o sessant'anni e la vista stanca sbaglia il
 * tocco. Nel riquadro del codice sconto — dentro la cassa, cioè nel punto in cui si sta cercando di
 * risparmiare — il pulsante «Applica» era alto 32 e «Rimuovi» era testo nudo, circa 30×16, senza
 * un pixel di imbottitura. Chi lo manca due o tre volte pensa che il sito non risponda.
 *
 * La prova legge la misura VERA dalle taglie del pulsante di casa (`components/ui/Button.tsx`), non
 * un numero riscritto qui: se un domani `md` scendesse sotto i 44, questa diventa rossa da sola.
 *
 * ⚠️ Non copre tutto il difetto: lo stepper «−»/«+» della barra d'acquisto mobile
 * (`components/StickyAddToCart.tsx`, 36px) è di un altro lotto e resta aperto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MINIMO = 44;

/** Le altezze minime dichiarate dalle taglie del pulsante di casa. */
function altezzeDelBottoneDiCasa(): Record<string, number> {
  const src = readFileSync('components/ui/Button.tsx', 'utf8');
  const blocco = src.slice(src.indexOf('const SIZES'), src.indexOf('const BASE'));
  const misure: Record<string, number> = {};
  for (const m of blocco.matchAll(/(\w+):\s*'[^']*min-h-\[(\d+)px\]/g)) misure[m[1]] = Number(m[2]);
  return misure;
}

describe('il riquadro del codice sconto, dentro la cassa', () => {
  const src = readFileSync('components/checkout/CouponInput.tsx', 'utf8');
  const altezze = altezzeDelBottoneDiCasa();

  it('le taglie del pulsante di casa sono leggibili: senza, questa prova non misura niente', () => {
    expect(Object.keys(altezze).sort()).toEqual(['lg', 'md', 'sm']);
    expect(altezze.sm, 'la taglia piccola è tornata a essere accettabile? allora questa regola va rivista').toBeLessThan(MINIMO);
  });

  it('«Applica» si tocca: nessun pulsante piccolo dentro la cassa', () => {
    const taglie = [...src.matchAll(/<Button[\s\S]*?size="(\w+)"/g)].map((m) => m[1]);
    expect(taglie.length, 'il riquadro non ha più pulsanti: questa prova non misura niente').toBeGreaterThan(0);
    for (const t of taglie) {
      expect(altezze[t] ?? 0, `un pulsante di taglia «${t}» è alto ${altezze[t]}px: sotto il minimo di ${MINIMO}`)
        .toBeGreaterThanOrEqual(MINIMO);
    }
  });

  it('«Rimuovi» ha un bersaglio, non è solo testo nudo', () => {
    const rimuovi = src.slice(src.indexOf('onClick={onRemove}'), src.indexOf('Rimuovi'));
    const m = rimuovi.match(/min-h-\[(\d+)px\]/);
    expect(m?.[1], 'il testo «Rimuovi» era un bersaglio da 30×16 pixel').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(MINIMO);
  });
});
