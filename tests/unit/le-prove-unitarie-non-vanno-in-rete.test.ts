import { describe, it, expect, afterAll } from 'vitest';

/**
 * 8/9/2026 — IL GUARDIANO DEL GUARDIANO.
 *
 * `tests/unit/_setup.ts` fa due cose per tutte le prove insieme: chiude la rete e
 * rimette a posto le variabili d'ambiente. Sono due cose che si notano solo quando
 * mancano — e si notano male: non con un errore, ma con prove che diventano rosse o
 * verdi a seconda di quale computer le fa girare e in che ordine.
 *
 * Quindi vanno provate. Se qualcuno toglie `setupFiles` dal `vitest.config.ts`, o
 * svuota quel file, questo diventa rosso subito e con scritto perche'.
 */

describe('le prove unitarie non vanno in rete', () => {
  it('una chiamata di rete non finta si ferma, e dice cosa fare al posto suo', async () => {
    await expect(
      fetch('https://nominatim.openstreetmap.org/search?q=piacenza'),
      'la rete e aperta: il verdetto delle prove dipende da un servizio di altri',
    ).rejects.toThrow(/Prova unitaria che va in rete/);
  });
});

describe('le variabili d ambiente tornano come le hanno trovate', () => {
  const sporcata = 'PROVA_SPORCIZIA_LASCIATA_IN_GIRO';

  it('una prova puo sporcare process.env quanto vuole', () => {
    process.env[sporcata] = 'si';
    expect(process.env[sporcata]).toBe('si');
  });

  // Gira dopo l'`afterEach` della preparazione: e' il momento in cui si vede se la
  // pulizia c'e' stata davvero. Dentro un `afterEach` di qui non si vedrebbe — quelli
  // vanno a ritroso, e questo girerebbe PRIMA di quello che deve controllare.
  afterAll(() => {
    expect(
      process.env[sporcata],
      'quello che una prova scrive in process.env sopravvive e lo trova la prossima',
    ).toBeUndefined();
  });
});
