import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fasciaLeggibile from '@/lib/ordini/fascia-leggibile';

/**
 * R09-009 — «Domani» premuto alle 23:59 e arrivato dopo mezzanotte si riporta al giorno della
 * richiesta con UNA regola sola.
 *
 * La regola viveva due volte, scritta a mano in app/api/orders/cod/route.ts e in
 * app/api/stripe/checkout/route.ts: due copie che potevano divergere su una cosa che decide il
 * giorno di consegna di un ordine pagato. Ora sta in lib/ordini/fascia-leggibile.ts e le due
 * rotte la importano da lì.
 */

const radice = join(__dirname, '..', '..');
const leggi = (p: string) => readFileSync(join(radice, p), 'utf8');

type Funzione = (fascia: string, giorno: string, adesso: Date) => string | null;
const regola = (fasciaLeggibile as unknown as Record<string, unknown>).fasciaDelGiornoDellaRichiesta as Funzione | undefined;

describe('R09-009 — la fascia detta dal giorno della richiesta ha una fonte sola', () => {
  it('lib/ordini/fascia-leggibile esporta la regola', () => {
    expect(typeof regola).toBe('function');
  });

  it('«Domani» di lunedì arrivato martedì alle 00:01 diventa «Oggi» (fuso di Roma)', () => {
    // Martedì 24/11/2026 alle 00:01 di Roma = 23:01 UTC di lunedì.
    const adesso = new Date('2026-11-23T23:01:00Z');
    expect(regola!('Domani · 9:00–11:00', '2026-11-24', adesso)).toBe('Oggi · 9:00–11:00');
  });

  it('una fascia «Oggi» di ieri arrivata dopo mezzanotte è passata (null)', () => {
    const adesso = new Date('2026-11-23T23:01:00Z');
    expect(regola!('Oggi · 9:00–11:00', '2026-11-23', adesso)).toBeNull();
  });

  it('senza mezzanotte in mezzo, o con l’orologio del telefono sbagliato di giorni, non sposta niente', () => {
    const lunediSera = new Date('2026-11-23T22:30:00Z'); // 23:30 di Roma, lunedì
    expect(regola!('Domani · 9:00–11:00', '2026-11-24', lunediSera)).toBe('Domani · 9:00–11:00');
    const adesso = new Date('2026-11-23T23:01:00Z');
    expect(regola!('Domani · 9:00–11:00', '2026-11-20', adesso)).toBe('Domani · 9:00–11:00');
    expect(regola!('Domani · 9:00–11:00', 'non-una-data', adesso)).toBe('Domani · 9:00–11:00');
  });

  it.each([
    'app/api/orders/cod/route.ts',
    'app/api/stripe/checkout/route.ts',
  ])('%s importa la regola da lib/ordini/fascia-leggibile e non ne tiene una copia', (file) => {
    const sorgente = leggi(file);
    expect(sorgente).not.toMatch(/function\s+fasciaDelGiornoDellaRichiesta\s*\(/);
    expect(sorgente).toMatch(
      /import\s*\{[^}]*\bfasciaDelGiornoDellaRichiesta\b[^}]*\}\s*from\s*'@\/lib\/ordini\/fascia-leggibile'/,
    );
    // E la usa davvero sul percorso della richiesta.
    expect(sorgente).toMatch(/fasciaDelGiornoDellaRichiesta\(body\.deliverySlot,\s*body\.delivery_date,\s*new Date\(\)\)/);
  });
});
