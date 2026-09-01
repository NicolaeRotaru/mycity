import { describe, it, expect } from 'vitest';
import { tassoAutorizzazione, tassoDaGuardare } from '@/lib/pagamenti/tasso-autorizzazione';

/**
 * 27/8/2026 (R046) — IL TASSO DI AUTORIZZAZIONE SI SCRIVEVA E NON LO LEGGEVA
 * NESSUNO.
 *
 * Ogni tentativo di pagamento con carta, riuscito o rifiutato, finiva in
 * `payment_attempts` col motivo del rifiuto. Poi: nessuna pagina, nessuna
 * query, nessun avviso. La domanda base del prodotto pagamenti — «quanti
 * pagamenti passano, e perché falliscono gli altri» — non aveva risposta pur
 * avendo il dato in casa. Un checkout rotto lo si sarebbe scoperto dal calo
 * degli ordini, giorni dopo.
 *
 * Qui c'è il conto, e la Panoramica dell'amministratore adesso lo mostra.
 */
describe('il conto dei pagamenti riusciti', () => {
  it('conta i riusciti sul totale di chi ci ha provato davvero', () => {
    const esito = tassoAutorizzazione([
      { status: 'succeeded' },
      { status: 'succeeded' },
      { status: 'succeeded' },
      { status: 'failed', decline_code: 'insufficient_funds' },
    ]);

    expect(esito.riusciti).toBe(3);
    expect(esito.falliti).toBe(1);
    expect(esito.tasso).toBe(0.75);
  });

  it('senza nemmeno un tentativo risponde «non lo so», non zero', () => {
    // Zero vorrebbe dire «tutti rifiutati»: sarebbe un allarme falso, e un
    // allarme falso e un allarme che si impara a ignorare.
    expect(tassoAutorizzazione([]).tasso).toBeNull();
  });

  it('dice quali sono i motivi piu frequenti dei rifiuti', () => {
    const esito = tassoAutorizzazione([
      { status: 'failed', decline_code: 'insufficient_funds' },
      { status: 'failed', decline_code: 'insufficient_funds' },
      { status: 'failed', decline_code: 'do_not_honor' },
      { status: 'failed', error_code: 'card_declined' },
      { status: 'failed' },
    ]);

    expect(esito.motivi[0]).toEqual({ codice: 'insufficient_funds', quanti: 2 });
    expect(esito.motivi.map((m) => m.codice)).toContain('card_declined');
    expect(esito.motivi.map((m) => m.codice), 'un rifiuto senza codice non deve sparire dal conto').toContain('sconosciuto');
  });

  it('gli stati che non conosciamo restano fuori dal conto', () => {
    const esito = tassoAutorizzazione([
      { status: 'succeeded' },
      { status: 'pending' },
      { status: null },
    ]);
    expect(esito.tentativi, 'un tentativo ancora in corso non e ne un successo ne un rifiuto').toBe(1);
  });
});

describe('quando il checkout va guardato subito', () => {
  const molti = (riusciti: number, falliti: number) =>
    tassoAutorizzazione([
      ...Array.from({ length: riusciti }, () => ({ status: 'succeeded' })),
      ...Array.from({ length: falliti }, () => ({ status: 'failed', decline_code: 'card_declined' })),
    ]);

  it('sotto il novanta per cento su abbastanza tentativi, si', () => {
    expect(tassoDaGuardare(molti(70, 30))).toBe(true);
  });

  it('su tre pagamenti non si grida: sono tre pagamenti', () => {
    expect(
      tassoDaGuardare(molti(1, 2)),
      'un allarme su un campione da niente e un allarme che si impara a ignorare',
    ).toBe(false);
  });

  it('con il checkout sano non si dice niente', () => {
    expect(tassoDaGuardare(molti(98, 2))).toBe(false);
  });
});
