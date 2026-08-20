import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PICKUP_DISCOUNT_PERCENT,
  RITIRO_IN_NEGOZIO_ATTIVO,
} from '@/lib/constants';
import { compensoRiderCents } from '@/lib/shipping';

/**
 * Il ritiro in negozio è messo da parte.
 *
 * Nicola, 20/8/2026: «togli il 10% di sconto per ritira in negozio, o mettilo
 * da parte per il momento, perche non ne ho ancora parlato con i negozi di
 * questo». Uno sconto sul prezzo di un negozio non si offre prima di
 * averglielo chiesto: quel 10% lo pagava il negoziante, che non lo sapeva.
 *
 * C'era anche un secondo motivo per spegnere l'opzione intera e non solo lo
 * sconto: un ordine ritirato in negozio non arrivava MAI a «consegnato». Il
 * solo modo di chiudere un ordine è il bottone del fattorino, e su un ritiro
 * il fattorino non c'è. Il negoziante consegnava a mano e restava senza
 * incasso, per sempre, mentre il cliente vedeva «in corso» all'infinito.
 *
 * Questi controlli tengono ferme tre cose: che non si offra, che non si possa
 * chiedere lo stesso da fuori, e che nessuno rimetta lo sconto per sbaglio.
 */

function leggi(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('il ritiro in negozio non si offre', () => {
  it('l opzione e spenta', () => {
    expect(RITIRO_IN_NEGOZIO_ATTIVO).toBe(false);
  });

  it('lo sconto e zero, cosi nessun negozio lo paga senza saperlo', () => {
    expect(PICKUP_DISCOUNT_PERCENT).toBe(0);
  });

  it('la tessera in cassa e dietro l interruttore, non sempre visibile', () => {
    const selettore = leggi('components/checkout/PaymentMethodSelector.tsx');
    expect(selettore).toContain('RITIRO_IN_NEGOZIO_ATTIVO &&');
  });
});

describe('e non si puo chiedere lo stesso da fuori', () => {
  // Il browser non e' una fonte fidata: una richiesta costruita a mano, o una
  // scheda rimasta aperta da prima del rilascio, puo' mandare pickupInStore
  // uguale a vero. Il server lo spegne subito dopo la convalida, una volta
  // sola, cosi' non c'e' un punto piu' sotto che possa sfuggire.
  for (const rotta of [
    'app/api/orders/cod/route.ts',
    'app/api/stripe/checkout/route.ts',
  ]) {
    it(`${rotta} spegne il ritiro chiesto dal browser`, () => {
      const codice = leggi(rotta);
      expect(codice).toContain('body.pickupInStore = RITIRO_IN_NEGOZIO_ATTIVO && body.pickupInStore;');
    });
  }
});

describe('il compenso del fattorino, col ritiro', () => {
  it('col ritiro non c e consegna, quindi non c e compenso', () => {
    expect(compensoRiderCents({ pickupInStore: true })).toBe(0);
  });

  it('con la consegna vera il compenso c e', () => {
    expect(compensoRiderCents({ pickupInStore: false })).toBeGreaterThan(0);
  });
});
