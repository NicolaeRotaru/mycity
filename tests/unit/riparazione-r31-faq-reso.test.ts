import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RESO_ESCLUSI } from '@/lib/promesse-pubbliche';

/**
 * R31-017 (prova leggera, testo) — La risposta delle domande frequenti sul reso
 * diceva due volte «fatti su ordinazione»: una dentro RESO_ESCLUSI, una aggiunta a mano.
 */
describe('FAQ: la risposta sul reso nomina i prodotti su ordinazione una volta sola', () => {
  const src = readFileSync('app/faq/page.tsx', 'utf8');
  const dopo = src.slice(src.indexOf('Posso restituire un prodotto?'));
  const riga = dopo.split('\n').find((r) => r.trim().startsWith('a: `'));

  it('dopo aver messo al posto la frase comune, «su ordinazione» compare una volta', () => {
    expect(riga).toBeDefined();
    const testo = riga!.replace('${RESO_ESCLUSI}', RESO_ESCLUSI);
    expect(testo.match(/su ordinazione/g)?.length).toBe(1);
    expect(testo).toContain('Hai 14 giorni dalla consegna');
  });
});
