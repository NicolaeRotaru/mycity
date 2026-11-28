import { describe, it, expect } from 'vitest';
import { ORDER_STATUS_LABEL, etichettaPronto, etichettaProntoGenerica } from '@/lib/order-status';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';

/**
 * 6/9/2026 — AL CLIENTE CHE ASPETTA A CASA IL SITO SCRIVEVA «PRONTO PER IL RITIRO».
 *
 * Il ritiro in negozio e' spento (`RITIRO_IN_NEGOZIO_ATTIVO = false`): a prendere l'ordine passa
 * il fattorino, sempre. Ma l'etichetta dello stato READY — quella della targhetta e della riga
 * nella fila dei passaggi — diceva «Pronto per il ritiro», e chi aspetta sul divano la legge come
 * «vai a ritirarlo tu». Sulla pagina di dettaglio la frase sotto lo spiegava; la targhetta, che
 * gira anche altrove, no.
 *
 * Ripasso: la parola «ritiro» non e' vietata — e' vietata finche' il ritiro non esiste. Percio'
 * l'etichetta nasce dall'interruttore: il giorno che il ritiro si riaccende, torna da se'.
 */
describe('l’etichetta di «pronto» segue l’interruttore del ritiro', () => {
  it('col ritiro spento non manda nessuno a ritirare', () => {
    expect(
      etichettaPronto(false),
      'col ritiro in negozio spento l’etichetta non deve nominare il ritiro: a prendere l’ordine va il fattorino',
    ).not.toMatch(/ritir/i);
  });

  it('e dice chi passa a prenderlo', () => {
    expect(etichettaPronto(false), 'l’etichetta deve dire che passa il fattorino').toMatch(/fattorino/i);
  });

  it('riacceso il ritiro, la parola torna da sé', () => {
    expect(etichettaPronto(true)).toMatch(/ritiro/i);
  });

  it('quella che gira sul sito oggi è coerente con l’interruttore di oggi', () => {
    if (RITIRO_IN_NEGOZIO_ATTIVO) {
      // R12-009 (28/11/2026) — Col ritiro acceso ci sono le due strade, e la targhetta non sa quale:
      // «Pronto per il ritiro» manderebbe in negozio chi aspetta a casa (il difetto qui sopra),
      // «Pronto per il fattorino» direbbe il contrario a chi ritira. Dice una cosa vera per tutti e
      // due; dove l'ordine è noto si usa `etichettaPronto(ordine.pickup_in_store)`.
      expect(ORDER_STATUS_LABEL.READY).toBe(etichettaProntoGenerica(true));
      expect(ORDER_STATUS_LABEL.READY, 'la targhetta generica non manda a ritirare chi aspetta a casa').not.toMatch(/ritir/i);
      expect(ORDER_STATUS_LABEL.READY).not.toMatch(/fattorino/i);
    } else {
      expect(
        ORDER_STATUS_LABEL.READY,
        'questa e’ l’etichetta che il cliente vede davvero: col ritiro spento non deve promettergli un ritiro',
      ).not.toMatch(/ritir/i);
    }
  });
});
