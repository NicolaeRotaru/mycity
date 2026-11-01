import { describe, it, expect } from 'vitest';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { motivoPrezzoRifiutato } from '@/lib/products/aiPatch';
// Collaudo S4: solo il prezzo, fuori banda -> 400 col motivo; la chat lo passa da friendlyError.
describe('il motivo del prezzo rifiutato arriva intero al negoziante', () => {
  it('toast della chat quando la rotta risponde 400 col motivo', () => {
    const motivo = motivoPrezzoRifiutato(10, 1);
    const corpo = { error: { message: motivo, details: { rifiutati: [{ campo: 'price', motivo }] } } };
    const mostrato = friendlyError(new Error(apiErrorMessage(corpo, 'Errore')));
    console.log('MOSTRATO:', JSON.stringify(mostrato), 'MOTIVO:', JSON.stringify(motivo));
    expect(mostrato).toContain('va deciso a mano');
  });
});
