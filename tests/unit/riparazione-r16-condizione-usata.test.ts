/**
 * R16-005 — «Seminuovo», «come nuovo», «non nuovo», letti dalla foto o dall'assistente, entravano
 * come «nuovo»: bastava la sillaba «nuov». Il primo giro (2261) aveva chiuso alcune frasi, ma
 * «Pari al nuovo», «Praticamente nuovo», «Like new», «tipo nuovo», «Non è stato usato molto» e
 * «Non usato da anni» davano ancora «nuovo», e un oggetto usato arrivava in vetrina come nuovo.
 *
 * Qui ogni frase della voce passa dalle due porte (`normalizeCondition` e
 * `condizioneDalSuggerimento`, usata dalla foto e dall'assistente): nessuna deve dare «nuovo».
 * Le frasi di un oggetto nuovo restano «nuovo».
 */
import { describe, it, expect } from 'vitest';
import { normalizeCondition, condizioneDalSuggerimento } from '@/lib/products/schema';

const USATI = [
  'Seminuovo',
  'semi-nuovo',
  'Come nuovo',
  'come nuova',
  'Non nuovo',
  'Non è nuovo',
  'Quasi nuovo',
  'Pari al nuovo',
  'Praticamente nuovo',
  'Like new',
  'tipo nuovo',
  'Non è stato usato molto',
  'Non usato da anni',
];

const NUOVI = ['nuovo', 'Nuovo', 'nuova', 'Nuovo con etichetta', 'Nuovo, mai usato', 'Brand new, never used', 'Nuovo, non è mai stato usato'];

describe('R16-005 · una frase da usato non entra come «nuovo»', () => {
  it.each(USATI)('«%s» non è «nuovo», né letto né suggerito', (frase) => {
    expect(normalizeCondition(frase)).not.toBe('nuovo');
    expect(condizioneDalSuggerimento(frase)).not.toBe('nuovo');
  });

  it.each(USATI)('«%s» si riconosce come usato, e il suggerimento si scarta', (frase) => {
    expect(normalizeCondition(frase)).toBe('usato');
    expect(condizioneDalSuggerimento(frase)).toBeNull();
  });

  it.each(NUOVI)('«%s» resta «nuovo»', (frase) => {
    expect(normalizeCondition(frase)).toBe('nuovo');
    expect(condizioneDalSuggerimento(frase)).toBe('nuovo');
  });
});
