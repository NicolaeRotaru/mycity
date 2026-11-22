import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => undefined }));

import { createProductSchema } from '@/lib/products/schema';
import { friendlyError } from '@/lib/errors';

/**
 * R10-013 — Il nome del prodotto ha al massimo 120 caratteri (vincolo del database, migrazione
 * 149): il modulo lo dice prima, la convalida e l'errore del database lo dicono in chiaro.
 */
const valori = (name: string) => ({
  name,
  description: 'Una descrizione abbastanza lunga da passare il controllo di qualità del modulo.',
  price: '10,00',
  unit: 'pezzo',
  category_id: '11111111-1111-4111-8111-111111111111',
});
const nomeErrore = (name: string) => {
  const r = createProductSchema({ minDescription: 30 }).safeParse(valori(name));
  return r.success ? undefined : r.error.issues.find((i) => i.path[0] === 'name')?.message;
};

describe('R10-013 — nome del prodotto: 120 caratteri', () => {
  it('la convalida del modulo dice il limite oltre 120', () => {
    expect(nomeErrore('a'.repeat(121)) ?? 'nessun errore').toMatch(/al massimo 120 caratteri/);
  });
  it('120 caratteri passano, anche con spazi ai lati (il nome si salva tagliato dagli spazi)', () => {
    expect(nomeErrore('a'.repeat(120))).toBeUndefined();
    expect(nomeErrore(`  ${'a'.repeat(120)}  `)).toBeUndefined();
  });
  it('si conta come il database: una emoji è un carattere, non due', () => {
    expect(nomeErrore('🍅'.repeat(120))).toBeUndefined();
    expect(nomeErrore('🍅'.repeat(121)) ?? 'nessun errore').toMatch(/120/);
  });

  it('l\'errore del database sul vincolo del nome si legge in chiaro', () => {
    const msg = friendlyError({
      code: '23514',
      message: 'new row for relation "products" violates check constraint "products_name_lunghezza"',
    });
    expect(msg).toMatch(/nome del prodotto è troppo lungo/);
    expect(msg).toMatch(/120/);
    expect(msg).not.toMatch(/valore inserito non è valido/);
  });
  it('un altro 23514 resta il messaggio generico', () => {
    expect(friendlyError({ code: '23514', message: 'violates check constraint "altro"' })).toMatch(/non è valido/);
  });

  it('il modulo dice il limite prima di scrivere', () => {
    const src = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    expect(src).toMatch(/hint=\{`Al massimo \$\{\w+\} caratteri/);
  });
});
