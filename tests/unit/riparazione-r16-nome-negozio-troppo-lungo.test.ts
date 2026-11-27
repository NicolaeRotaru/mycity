import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/lib/errors';

/**
 * R16-007 — Il tetto di 80 caratteri sul nome del negozio (migrazione 830) dà un 23514 con la frase
 * «Il nome del negozio puo' avere al massimo 80 caratteri»: l'utente legge un messaggio chiaro,
 * non il generico «Il valore inserito non è valido.».
 */
describe('R16-007 · nome del negozio troppo lungo', () => {
  const errore = { code: '23514', message: "Il nome del negozio puo' avere al massimo 80 caratteri" };

  it('esce un messaggio specifico con il limite', () => {
    const m = friendlyError(errore);
    expect(m).toContain('nome del negozio');
    expect(m).toContain('80');
    expect(m).not.toContain('Il valore inserito non è valido');
  });

  it('un altro 23514 resta quello generico', () => {
    expect(friendlyError({ code: '23514', message: 'new row violates check constraint "x"' })).toBe('Il valore inserito non è valido.');
  });
});
