/**
 * @vitest-environment jsdom
 */
/**
 * 27/8/2026 (R170) — IL FUNNEL DELL'AMMINISTRAZIONE LEGGEVA UN CAMPIONE E LO
 * DICEVA SOLO ALLA CONSOLE.
 *
 * La lettura degli iscritti passa da `leggiTutteLeRighe`, che chiede una
 * finestra per volta finché finiscono ma si ferma a un tetto duro — non si
 * scarica un database intero dentro un browser. Quando ci sbatte torna
 * `troncato: true`, e il funnel quella bandierina la prendeva davvero:
 *
 *     if (iscrittiTroncati) { logger.warn('[funnel] tetto duro raggiunto…'); }
 *
 * Un avviso nella console degli sviluppatori. A schermo, intanto, restavano le
 * percentuali di attivazione e la tabella delle coorti disegnate come se
 * fossero il totale — e nessuno guarda la console mentre legge un cruscotto.
 *
 * Il momento in cui il tetto scatta è proprio quello in cui i numeri iniziano a
 * contare. Da lì in poi il funnel mostra meno iscritti di quanti ce ne siano, e
 * la lettura più naturale è «la crescita sta rallentando» — cioè la conclusione
 * opposta a quella vera. La pagina Attività questa cosa la dice già accanto al
 * numero («campione: ultime 3000 righe»); il funnel no.
 *
 * Qui la lettura del funnel viene ESEGUITA — è la funzione vera della pagina,
 * presa dalla query — contro un database finto che risponde sempre con una
 * finestra piena, cioè il caso in cui il tetto scatta. Poi la pagina viene
 * disegnata con quel risultato in mano, e si guarda se lo dice.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

type Lettura = { queryFn?: () => Promise<Record<string, unknown>> };

const globale = globalThis as Record<string, unknown>;

/** Una finestra sempre piena: è così che si arriva al tetto duro. */
const FINESTRA_PIENA = Array.from({ length: 1000 }, (_, i) => ({
  id: `iscritto-${i}`,
  created_at: '2026-08-01T10:00:00Z',
}));

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__RISPOSTA_SUPABASE__;
});

describe('il funnel quando gli iscritti non ci stanno tutti in una lettura', () => {
  it('riporta di aver letto un campione, invece di tenerselo per sé', async () => {
    // La pagina si monta solo per farsi consegnare la sua lettura vera.
    let lettura: Lettura | null = null;
    globale.__DATI_QUERY__ = (opzioni: Lettura) => { lettura = opzioni; return undefined; };
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    s.smonta();

    expect(lettura, 'la pagina Funnel non ha una lettura da eseguire').not.toBeNull();

    // Il database risponde sempre con una finestra piena di iscritti: la
    // lettura continua a chiederne finché sbatte contro il tetto.
    globale.__RISPOSTA_SUPABASE__ = ({ tavola }: { tavola: string }) =>
      tavola === 'profiles'
        ? { data: FINESTRA_PIENA, error: null }
        : { data: [], error: null };

    const dati = await (lettura as unknown as Lettura).queryFn!();

    expect(
      dati.campione,
      'La lettura si era fermata a metà e il risultato non se lo portava dietro: la pagina non poteva dirlo nemmeno volendo',
    ).toBe(true);
    expect(
      Number(dati.iscrittiLetti),
      'Insieme alla bandierina serve il numero vero di righe lette, altrimenti «campione» non dice di quanto',
    ).toBeGreaterThan(1000);
  }, 60000);

  it('la pagina scrive accanto ai numeri che sono un campione', async () => {
    globale.__DATI_QUERY__ = {
      signups: 20_000,
      firstOrderWithin7d: 1000,
      firstOrderEver: 2000,
      multipleOrders: 500,
      aRischioChurn: 100,
      iscrittiLetti: 20_000,
      campione: true,
      cohortRetention: [{ month: 'ago 26', cohortSize: 10, m1: 3, m2: null, m3: null }],
    };
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(testo, 'la pagina Funnel deve comunque mostrare i suoi numeri').toContain('Activation');
    expect(
      testo.toLowerCase(),
      'Il funnel mostrava percentuali calcolate su un troncone come se fossero il totale, e l\'avviso restava nella console',
    ).toContain('campione');
    expect(
      testo,
      'Chi legge deve sapere di quante righe si tratta, non solo che «è un campione»',
    ).toContain('20000');
    s.smonta();
  }, 60000);

  it('quando invece ha letto tutto non spaventa nessuno', async () => {
    globale.__DATI_QUERY__ = {
      signups: 12,
      firstOrderWithin7d: 4,
      firstOrderEver: 6,
      multipleOrders: 2,
      aRischioChurn: 1,
      iscrittiLetti: 12,
      campione: false,
      cohortRetention: [{ month: 'ago 26', cohortSize: 10, m1: 3, m2: null, m3: null }],
    };
    const mod = await monta('app/admin/funnel/page.tsx');
    const s = accendi(mod.default as ComponentType);
    expect(
      (s.radice.textContent ?? '').toLowerCase(),
      'Con tutti gli iscritti in mano l\'avviso non deve comparire, altrimenti smette di voler dire qualcosa',
    ).not.toContain('campione');
    s.smonta();
  }, 60000);
});
