import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutChiuso, type StatoInvio } from '@/lib/ordini/partenza';

/**
 * L'ORDINE PARTITO NON TORNA INDIETRO (radiografia del design, 22/8/2026).
 *
 * Il blocco del pulsante «Conferma ordine» era `placeOrders.isPending ||
 * payWithStripe.isPending`. In React Query 5 lo stato «in corso» si spegne DOPO
 * `onSuccess`, non prima: c'era una finestra in cui il pulsante tornava premibile
 * mentre la pagina stava ancora andando via.
 *
 * Sul ramo contanti la finestra è peggiore che altrove, perché `onSuccess` ha già
 * buttato la chiave anti-doppione: il secondo tocco non viene riconosciuto come
 * ripetizione, crea un ordine NUOVO, e il cliente paga due volte.
 *
 * Queste prove ESEGUONO la decisione invece di rileggerla. Finché stava dentro un
 * componente React da 1.200 righe non si poteva fare: è per questo che il primo
 * pezzo del fix è stato tirarla fuori.
 */

const fermo: StatoInvio = { isPending: false, isSuccess: false };
const inCorso: StatoInvio = { isPending: true, isSuccess: false };
/** La finestra che rompeva: l'invio è finito bene, `isPending` è già sceso. */
const appenaRiuscito: StatoInvio = { isPending: false, isSuccess: true };

describe('checkoutChiuso — la finestra che costava un ordine doppio', () => {
  it('a riposo il checkout è aperto: il pulsante deve funzionare', () => {
    expect(checkoutChiuso(false, fermo, fermo)).toBe(false);
  });

  it('mentre l’ordine in contanti è in volo, è chiuso', () => {
    expect(checkoutChiuso(false, inCorso, fermo)).toBe(true);
  });

  it('IL CASO CHE ROMPEVA — contanti appena riuscito, `isPending` già sceso', () => {
    expect(checkoutChiuso(false, appenaRiuscito, fermo)).toBe(true);
  });

  it('IL CASO CHE ROMPEVA — carta appena riuscita, mentre il browser naviga verso Stripe', () => {
    expect(checkoutChiuso(false, fermo, appenaRiuscito)).toBe(true);
  });

  it('`inPartenza` da solo basta: è il segnale che `onSuccess` alza per primo', () => {
    expect(checkoutChiuso(true, fermo, fermo)).toBe(true);
  });

  it('`inPartenza` non si spegne mai: resta chiuso anche quando tutto il resto è a riposo', () => {
    // È la differenza fra questo blocco e quello di prima. Il vecchio tornava false
    // appena le mutation si calmavano — cioè proprio mentre la pagina se ne andava.
    expect(checkoutChiuso(true, fermo, fermo)).toBe(true);
  });
});

describe('il fix è montato dove serve, non solo scritto', () => {
  const pagina = readFileSync(resolve(__dirname, '..', '..', 'app/checkout/page.tsx'), 'utf8');

  it('la pagina usa la funzione condivisa invece di rifarsi il conto in casa', () => {
    expect(pagina).toContain('checkoutChiuso(inPartenza, placeOrders, payWithStripe)');
  });

  it('entrambi gli `onSuccess` alzano `inPartenza` come PRIMA cosa', () => {
    // Prima cosa e non ultima: fra l'inizio di onSuccess e la sua fine c'è
    // `chiudiIlTentativo()`, che butta la chiave anti-doppione. Alzarlo dopo
    // lascerebbe scoperta proprio la parte pericolosa.
    const successi = [...pagina.matchAll(/onSuccess: \([^)]*\) => \{\n(\s*)(.+)/g)].map((m) => m[2].trim());
    expect(successi.length).toBeGreaterThanOrEqual(2);
    for (const prima of successi) {
      expect(prima).toBe('setInPartenza(true);');
    }
  });

  it('`handleSubmit` si ferma da solo, perché a un invio si arriva anche senza toccare il pulsante', () => {
    const corpo = pagina.slice(pagina.indexOf('const handleSubmit'));
    const guardia = corpo.indexOf('if (isCheckingOut) return;');
    const validazione = corpo.indexOf('validateAddress()');
    expect(guardia).toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(validazione);
  });

  it('`inPartenza` non viene mai rimesso a false', () => {
    expect(pagina).not.toContain('setInPartenza(false)');
  });
});
