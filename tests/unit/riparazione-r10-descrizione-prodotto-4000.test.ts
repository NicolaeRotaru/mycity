import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => undefined }));

import { createProductSchema } from '@/lib/products/schema';
import { friendlyError } from '@/lib/errors';

/**
 * R10-013 (collaudo K04) — La descrizione ha un tetto nel database (4000 caratteri, migrazione 149):
 * oltre, il negozio leggeva solo «Il valore inserito non è valido». Ora lo dice il modulo, e lo dice
 * anche l'errore del database tradotto.
 */
const valori = (description: string) => ({
  name: 'Pane di Altamura',
  description,
  price: '10,00',
  unit: 'pezzo',
  category_id: '11111111-1111-4111-8111-111111111111',
});
const erroreDescrizione = (description: string) => {
  const r = createProductSchema({ minDescription: 30 }).safeParse(valori(description));
  return r.success ? undefined : r.error.issues.find((i) => i.path[0] === 'description')?.message;
};

describe('R10-013 — descrizione del prodotto: 4000 caratteri', () => {
  it('oltre 4000 la convalida dice il limite', () => {
    expect(erroreDescrizione('a'.repeat(4001)) ?? 'nessun errore').toMatch(/al massimo 4000 caratteri/);
  });
  it('4000 passano, contati come il database (emoji = 1, spazi ai lati non contano)', () => {
    expect(erroreDescrizione('a'.repeat(4000))).toBeUndefined();
    expect(erroreDescrizione(`  ${'🍞'.repeat(4000)}  `)).toBeUndefined();
    expect(erroreDescrizione('🍞'.repeat(4001))).toMatch(/al massimo/);
  });
  it('il vincolo del database sulla descrizione ha la sua frase; gli altri 23514 restano generici', () => {
    const msg = friendlyError({ code: '23514', message: 'new row violates check constraint "products_description_lunghezza"' });
    expect(msg).toMatch(/descrizione del prodotto è troppo lunga/);
    expect(friendlyError({ code: '23514', message: 'violates check constraint "price_check"' })).not.toMatch(/descrizione/);
  });
});
