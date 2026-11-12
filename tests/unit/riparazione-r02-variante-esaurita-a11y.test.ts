import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-008 (12/11/2026) — Prova leggera di accessibilità. Se scegli una variante esaurita:
 *  · il pulsante d'acquisto resta nel giro del Tab (aria-disabled, non disabled), dice di non
 *    essere disponibile e punta al messaggio della disponibilità;
 *  · premuto, non aggiunge niente: lo dice;
 *  · i valori che portano solo a combinazioni esaurite lo dicono nel nome, prima di sceglierli.
 * (La regione che annuncia «Variante esaurita» c'era già dal 5/11.)
 */
const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
const pulsante = src.slice(src.indexOf('id="acquisto-principale"'), src.indexOf("{needsVariantChoice ? 'Scegli le opzioni'"));
const handleAdd = src.slice(src.indexOf('const handleAdd = () => {'), src.indexOf('const handleBuyNow'));

describe('R02-008 · la variante esaurita e il lettore di schermo', () => {
  it('il pulsante d acquisto resta raggiungibile da tastiera e dice perché', () => {
    expect(pulsante).toMatch(/aria-disabled=\{!canAdd \|\| undefined\}/);
    expect(pulsante).not.toMatch(/\bdisabled=\{!canAdd\}/);
    expect(pulsante).toMatch(/aria-describedby=\{hasVariants && optionGroups\.length > 0 \? 'disponibilita-variante' : undefined\}/);
    // Il contrasto: niente opacity-50 (1,62:1), l'aspetto spento esplicito del Button.
    expect(pulsante).not.toMatch(/opacity-50/);
    expect(pulsante).toMatch(/aria-disabled:bg-cream-200 aria-disabled:text-ink-600/);
    expect(src).toMatch(/<div id="disponibilita-variante">\s*<div role="status" aria-live="polite">/);
  });

  it('premuto su una combinazione esaurita non aggiunge al carrello', () => {
    const guardia = handleAdd.indexOf('if (isOutOfStock)');
    expect(guardia).toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(handleAdd.indexOf('addToCart('));
  });

  it('il valore che porta solo a combinazioni esaurite lo dice nel nome', () => {
    expect(src).toMatch(/aria-label=\{esaurito \? `\$\{val\}, esaurito` : undefined\}/);
    expect(src).toMatch(/conQuestoValore\.every\(\(v\) => v\.stock === 0\)/);
  });
});
