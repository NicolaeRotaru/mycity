import { describe, it, expect } from 'vitest';
import { promessaSuperata } from '@/lib/site-branding';

/** S08 (5/11/2026) — scheda 2636: il freno riconosce le riformulazioni dei 30-60 minuti. */
describe('il freno delle promesse superate', () => {
  for (const frase of ['Arriva in 30-60 min', 'consegna da 30 a 60 minuti', 'in 30/60 min a casa tua', "arriva in mezz'ora", 'arriva in mezz’ora']) {
    it(`ferma «${frase}»`, () => {
      expect(promessaSuperata(frase)).not.toBeNull();
    });
  }
  it('lascia passare la stessa promessa detta come consegna veloce', () => {
    expect(promessaSuperata('con la consegna veloce arriva da 30 a 60 minuti')).toBeNull();
  });
  it('lascia passare una frase senza minuti', () => {
    expect(promessaSuperata('Consegna all ora che scegli')).toBeNull();
  });
});
