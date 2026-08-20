import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));

import { logger } from '@/lib/logger';

/**
 * «Rimborso fallito, {}».
 *
 * La firma è `logger.error(errore, contesto)`, ma in settantuno chiamate su
 * ottantaquattro è scritta al contrario — `logger.error('rimborso fallito', err)`
 * — perché è così che si scrive in mezzo mondo. Con gli argomenti invertiti
 * l'Error finiva nel contesto, e `Object.entries()` su un Error torna una lista
 * vuota: nel log restava la frase e spariva il motivo.
 *
 * Chi apriva i log dopo un rimborso fallito non sapeva perché era fallito.
 */

describe('logger.error non perde mai il motivo', () => {
  let righe: string[] = [];
  beforeEach(() => {
    righe = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { righe.push(a.map(String).join(' ')); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("scritto al contrario — error('frase', errore) — il motivo resta nel log", () => {
    logger.error('rimborso fallito', new Error('carta rifiutata dalla banca'));
    expect(righe.join('\n')).toContain('carta rifiutata dalla banca');
    expect(righe.join('\n')).toContain('rimborso fallito');
  });

  it('scritto nel verso giusto, il contesto resta leggibile', () => {
    logger.error(new Error('boom'), { orderId: 'ord-1' });
    const riga = righe.join('\n');
    expect(riga).toContain('boom');
    expect(riga).toContain('ord-1');
  });

  it("un Error dentro il contesto non diventa un oggetto vuoto", () => {
    logger.error(new Error('principale'), { causa: new Error('vera causa') });
    expect(righe.join('\n')).toContain('vera causa');
  });

  it('i dati personali restano oscurati', () => {
    logger.error(new Error('x'), { email: 'mario@rossi.it', orderId: 'ord-2' });
    const riga = righe.join('\n');
    expect(riga).not.toContain('mario@rossi.it');
    expect(riga).toContain('[redacted]');
  });
});
