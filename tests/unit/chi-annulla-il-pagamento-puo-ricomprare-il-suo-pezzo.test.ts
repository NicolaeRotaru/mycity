import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chiaveDellaRiga,
  merceCheTengoIo,
  problemiDiDisponibilita,
  type TentativoAperto,
} from '@/lib/ordini/merce-che-tengo-io';

/**
 * CHI ANNULLA IL PAGAMENTO DEVE POTER RICOMPRARE IL SUO PEZZO.
 *
 * Il caso: una torta, un pezzo solo. Il cliente preme «Paga con carta», il
 * server scala la giacenza e apre Stripe, lui fa indietro. Tornato in cassa
 * leggeva «richiesti 1, disponibili 0»: il pulsante d'ordine spento, la
 * richiesta che non parte, e il rilascio della riserva — che vive dentro le due
 * rotte d'ordine — mai raggiunto. Per due ore quel pezzo era invisibile a lui e
 * a tutti gli altri.
 *
 * La riga di `pending_checkouts` qui sotto ha la forma vera con cui la scrive
 * `app/api/stripe/checkout/route.ts` (`groups[].items[]`), la stessa che legge
 * `liberaRiserveAbbandonate` quando decide cosa liberare.
 */

const TORTA = '11111111-1111-4111-8111-111111111111';

/** Il tentativo aperto che sta tenendo l'ultimo pezzo di torta. */
const MIO_TENTATIVO: TentativoAperto = {
  groups: [
    {
      items: [{ productId: TORTA, quantity: 1, variantId: null }],
    },
  ],
};

const CARRELLO = [{ id: TORTA, name: 'Torta', quantity: 1, variantId: null }];

/** La giacenza letta dal database: zero, perché l'ha scalata la sua riserva. */
const scaffaleVuoto = () => 0;

describe('la disponibilità dipende da chi guarda', () => {
  it('l\'ultimo pezzo che sto tenendo io non risulta esaurito a me', () => {
    const tengoIo = merceCheTengoIo([MIO_TENTATIVO]);
    expect(tengoIo.get(chiaveDellaRiga(TORTA, null))).toBe(1);

    const problemi = problemiDiDisponibilita(CARRELLO, scaffaleVuoto, tengoIo);

    expect(
      problemi,
      'la cassa dice ancora «non più disponibile» sul pezzo che questa persona sta comprando: pulsante spento e riserva mai liberata',
    ).toEqual([]);
  });

  it('lo stesso pezzo tenuto da un ALTRO resta esaurito, e la cassa blocca', () => {
    // Nessun tentativo mio: la merce è impegnata da qualcun altro. Qui il
    // blocco è giusto e deve restare — altrimenti la riparazione sarebbe solo
    // un controllo spento, e si venderebbe merce che non c'è.
    const problemi = problemiDiDisponibilita(CARRELLO, scaffaleVuoto, merceCheTengoIo([]));
    expect(problemi).toEqual([{ id: TORTA, name: 'Torta', requested: 1, available: 0 }]);
  });

  it('tengo un pezzo ma ne voglio due: manca ancora quello che manca davvero', () => {
    const problemi = problemiDiDisponibilita(
      [{ id: TORTA, name: 'Torta', quantity: 2, variantId: null }],
      scaffaleVuoto,
      merceCheTengoIo([MIO_TENTATIVO]),
    );
    expect(problemi).toEqual([{ id: TORTA, name: 'Torta', requested: 2, available: 1 }]);
  });

  it('la riserva di una variante non si somma alla riga senza variante', () => {
    const conVariante: TentativoAperto = {
      groups: [{ items: [{ productId: TORTA, quantity: 1, variantId: 'grande' }] }],
    };
    const tengoIo = merceCheTengoIo([conVariante]);
    expect(problemiDiDisponibilita(CARRELLO, scaffaleVuoto, tengoIo)).toHaveLength(1);
    expect(
      problemiDiDisponibilita(
        [{ id: TORTA, name: 'Torta grande', quantity: 1, variantId: 'grande' }],
        scaffaleVuoto,
        tengoIo,
      ),
    ).toEqual([]);
  });
});

describe('la cassa e il carrello contano la merce che il cliente sta tenendo', () => {
  const cassa = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf-8');
  const carrello = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf-8');

  it('la cassa chiede i propri tentativi aperti e li conta nella disponibilità', () => {
    expect(cassa).toContain("from('pending_checkouts')");
    // Non basta chiamarla: la merce tenuta da questa persona deve entrarci
    // davvero, altrimenti il conto torna quello di prima.
    expect(cassa).toMatch(/problemiDiDisponibilita\([\s\S]{0,300}?tengoIo/);
    // Il vecchio conto scritto a mano non deve tornare: era quello che spegneva
    // il pulsante sul pezzo appena riservato dalla stessa persona.
    expect(cassa).not.toMatch(/it\.quantity > availableFor\(it\)/);
  });

  it('il pulsante d\'ordine resta legato ai problemi di disponibilità', () => {
    // Se non ci sono problemi il pulsante è vivo: è questa riga a farlo, e senza
    // di lei la prova qui sopra non direbbe niente sul comportamento.
    expect(cassa).toContain('stockIssues.length > 0');
  });

  it('il carrello non dice «non più disponibile» sul pezzo che sto comprando', () => {
    expect(carrello).toContain("from('pending_checkouts')");
    expect(carrello).toContain('merceCheTengoIo(');
  });
});
