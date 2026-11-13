import { describe, expect, it } from 'vitest';

import { linkWhatsApp } from '@/lib/contatto-whatsapp';

/**
 * R22-014 — Il WhatsApp di MyCity (piè di pagina, Contattaci, le tre pagine d'aiuto) scritto senza
 * +39 apriva wa.me con le cifre nude: «333 1234567» diventava un numero francese (+33). Adesso il
 * link prende il 39 come il bottone della vetrina del negozio (la 580).
 */
describe('R22-014 · il WhatsApp di MyCity scritto senza +39', () => {
  it('un cellulare scritto all\'italiana apre il +39', () => {
    expect(linkWhatsApp('333 1234567')).toBe('https://wa.me/393331234567');
    expect(linkWhatsApp('333 123 4567', 'Ciao MyCity')).toBe('https://wa.me/393331234567?text=Ciao%20MyCity');
  });

  it('un fisso di Piacenza scritto con lo 0 apre il +39', () => {
    expect(linkWhatsApp('0523 123456')).toBe('https://wa.me/390523123456');
  });

  it('chi l\'ha già scritto col prefisso non cambia', () => {
    expect(linkWhatsApp('+39 333 1234567')).toBe('https://wa.me/393331234567');
    expect(linkWhatsApp('0039 333 1234567')).toBe('https://wa.me/393331234567');
    expect(linkWhatsApp('393331234567')).toBe('https://wa.me/393331234567');
  });

  it('un numero straniero col + resta il suo', () => {
    expect(linkWhatsApp('+44 20 7946 0958')).toBe('https://wa.me/442079460958');
  });

  it('il segnaposto, anche scritto senza prefisso, resta senza link', () => {
    expect(linkWhatsApp('300 000 0000')).toBeNull();
    expect(linkWhatsApp('393000000000')).toBeNull();
  });

  it('il segnaposto con 0039 o +39 davanti resta senza link', () => {
    for (const n of ['0039 300 0000000', '00393000000000', '0039 0000000000', '+39 000 0000000']) {
      expect(linkWhatsApp(n), n).toBeNull();
    }
  });
});
