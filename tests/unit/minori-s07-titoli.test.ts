import { describe, expect, it } from 'vitest';

const PAGINE: Array<[string, string]> = [
  ['cart', 'Il tuo carrello · MyCity'],
  ['checkout', 'Conferma il tuo ordine · MyCity'],
  ['sign-in', 'Accedi · MyCity'],
  ['sign-up', 'Registrati · MyCity'],
  ['reset-password', 'Reimposta la password · MyCity'],
  ['categorie', 'Tutte le categorie · MyCity'],
  ['promozioni', 'Promozioni · MyCity'],
  ['novita', 'Novità · MyCity'],
];

describe('S07 · ogni pagina del percorso d’acquisto ha il suo titolo', () => {
  for (const [cartella, titolo] of PAGINE) {
    it(`/${cartella} → «${titolo}»`, async () => {
      const { metadata } = await import(`@/app/${cartella}/layout`);
      expect(metadata.title).toBe(titolo);
      expect(metadata.title).not.toMatch(/Marketplace dei negozi della tua città/);
    });
  }
});
