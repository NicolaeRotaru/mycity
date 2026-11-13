import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R09-014 — Nel dettaglio dell'ordine le tappe uscivano nel fuso del telefono: col telefono in UTC,
// «22:35» invece delle 23:35 di Piacenza. Prova leggera: la riga usa il fuso di Piacenza e niente secondi.
describe('R09-014 · le tappe dell’ordine sono nell’ora di Piacenza', () => {
  const s = readFileSync('app/orders/[id]/page.tsx', 'utf8');

  it('la data della tappa si scrive col fuso di Piacenza', () => {
    expect(s).not.toMatch(/new Date\(ts\)\.toLocaleString\('it-IT'\)/);
    expect(s).toMatch(/new Date\(ts\)\.toLocaleString\('it-IT', ORA_DELLA_TAPPA\)/);
    expect(s).toMatch(/const ORA_DELLA_TAPPA[^=]*=\s*\{\s*timeZone: FUSO_PIACENZA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',/);
  });

  it('con quelle opzioni l’accettazione delle 22:35Z del 6/11 si legge 23:35', () => {
    const t = new Date('2026-11-06T22:35:00Z').toLocaleString('it-IT', {
      timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    expect(t).toContain('23:35');
    expect(t).toContain('06/11');
  });
});
