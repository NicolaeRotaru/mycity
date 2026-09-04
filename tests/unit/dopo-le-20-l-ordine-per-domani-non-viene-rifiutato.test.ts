import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { negozioPuoServire, motivoNegozioChiuso, leggiFasciaConsegna } from '@/lib/store-hours';
import { FASCE_DI_DOMANI, ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * LA CASSA PROMETTEVA «DOMANI» E IL SERVER RIFIUTAVA «È CHIUSO ADESSO».
 *
 * Martedì alle 21:15 Maria mette una torta della pasticceria (aperta 8–19) nel
 * carrello, compila indirizzo e telefono, sceglie «Domani · 9:00–12:00» — la
 * cassa dopo le 20 parte da sola su domani — e preme «Ordina». Le due rotte che
 * creano l'ordine guardavano solo l'orologio e rispondevano «Pasticceria è
 * chiuso in questo momento». La sera è l'ora in cui si compra per il giorno
 * dopo: ogni ordine serale a domicilio moriva all'ultimo clic.
 *
 * Qui si esegue la decisione, non si rilegge un testo.
 */

// Martedì 26 maggio 2026, le 21:15. Fuori orario per un negozio che chiude alle 19.
const martediSera = new Date('2026-05-26T21:15:00');
// Sabato 30 maggio 2026, le 21:15: il giorno dopo è domenica.
const sabatoSera = new Date('2026-05-30T21:15:00');

const pasticceria = {
  mon: [['8:00', '19:00']],
  tue: [['8:00', '19:00']],
  wed: [['8:00', '19:00']],
  thu: [['8:00', '19:00']],
  fri: [['8:00', '19:00']],
  sat: [['8:00', '19:00']],
  // domenica chiuso: nessuna chiave `sun`
} as unknown;

describe('la sera, un ordine per domani passa se domani il negozio è aperto', () => {
  it('martedì 21:15, fascia «Domani · 9:00–12:00» → l’ordine parte', () => {
    expect(negozioPuoServire(pasticceria, 'Domani · 9:00–12:00', martediSera)).toBe(true);
  });

  it('tutte le fasce di domani che la cassa può proporre sono servibili', () => {
    for (const fascia of FASCE_DI_DOMANI) {
      expect(negozioPuoServire(pasticceria, fascia, martediSera), fascia).toBe(true);
    }
  });

  it('ma se domani è chiuso, l’ordine si ferma — e lo dice prima di prendere i soldi', () => {
    expect(negozioPuoServire(pasticceria, 'Domani · 9:00–12:00', sabatoSera)).toBe(false);
    expect(motivoNegozioChiuso('Pasticceria', 'Domani · 9:00–12:00')).toContain('domani');
  });

  it('e se domani è aperto ma NON in quella fascia, si ferma lo stesso', () => {
    const soloMattina = { wed: [['8:00', '13:00']] } as unknown;
    expect(negozioPuoServire(soloMattina, 'Domani · 18:30–20:00', martediSera)).toBe(false);
    // La stessa fascia su un negozio che chiude alle 19 va bene: mezz'ora basta.
    expect(negozioPuoServire(pasticceria, 'Domani · 18:30–20:00', martediSera)).toBe(true);
  });
});

describe('per «adesso» la regola resta quella di prima: il fattorino non va a vuoto', () => {
  it('nessuna fascia scelta, negozio chiuso adesso → rifiuto', () => {
    expect(negozioPuoServire(pasticceria, null, martediSera)).toBe(false);
    expect(motivoNegozioChiuso('Pasticceria', null)).toContain('in questo momento');
  });

  it('consegna immediata con negozio chiuso adesso → rifiuto', () => {
    expect(negozioPuoServire(pasticceria, ETICHETTA_ADESSO, martediSera)).toBe(false);
  });

  it('fascia di oggi con negozio chiuso adesso → rifiuto', () => {
    expect(negozioPuoServire(pasticceria, 'Stasera · 18:00–20:00', martediSera)).toBe(false);
  });

  it('negozio aperto adesso → passa', () => {
    const martediMattina = new Date('2026-05-26T10:00:00');
    expect(negozioPuoServire(pasticceria, null, martediMattina)).toBe(true);
  });

  it('orari mai impostati: nessun blocco, come prima', () => {
    expect(negozioPuoServire(null, 'Domani · 9:00–12:00', martediSera)).toBe(true);
    expect(negozioPuoServire({}, null, martediSera)).toBe(true);
    expect(negozioPuoServire({ wed: [] }, null, martediSera)).toBe(true);
  });
});

describe('le etichette della cassa e il lettore del server parlano la stessa lingua', () => {
  it('ogni fascia di domani viene letta come «domani», con le sue ore', () => {
    for (const fascia of FASCE_DI_DOMANI) {
      const letta = leggiFasciaConsegna(fascia);
      expect(letta, fascia).not.toBeNull();
      expect(letta?.domani).toBe(true);
      expect(letta?.aMinuti).toBeGreaterThan(letta?.daMinuti ?? 0);
    }
  });

  it('«adesso» e le fasce di oggi non vengono scambiate per domani', () => {
    expect(leggiFasciaConsegna(ETICHETTA_ADESSO)).toBeNull();
    expect(leggiFasciaConsegna('In giornata · 15:00–18:00')).toBeNull();
    expect(leggiFasciaConsegna(null)).toBeNull();
  });
});

describe('le due rotte dei soldi passano davvero la fascia scelta', () => {
  const radice = process.cwd();
  for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
    it(`${rotta} decide sulla fascia, non solo sull'orologio`, () => {
      const src = readFileSync(join(radice, rotta), 'utf8');
      // Senza `body.deliverySlot` la funzione ricadrebbe sempre su «adesso» e il
      // difetto tornerebbe identico, con la prova qui sopra ancora verde.
      expect(src).toMatch(/negozioPuoServire\([\s\S]{0,140}?body\.deliverySlot/);
      expect(src, 'il rifiuto deve restare un conflitto').toMatch(/conflict\(/);
    });
  }
});
