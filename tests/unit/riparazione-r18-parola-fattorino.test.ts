/**
 * R18-006 — Il pulsante del negozio dice «fattorino»: la pagina dell'ordine e l'email dell'ordine pronto
 * non devono più dire «rider» al cliente. Prova leggera sul sorgente.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe('R18-006 la parola «fattorino» al cliente', () => {
  it('le frasi di stato della pagina dell’ordine dicono «fattorino»', () => {
    const src = leggi('app/orders/[id]/page.tsx');
    const blocco = src.slice(src.indexOf('HERO_SUBTITLE'), src.indexOf('DELIVERED:', src.indexOf('HERO_SUBTITLE')));
    expect(blocco).toMatch(/un fattorino passa a prenderlo a breve/);
    expect(blocco).toMatch(/Un fattorino sta arrivando in negozio/);
    expect(blocco).toMatch(/Il fattorino ha ritirato il tuo ordine/);
    expect(blocco).toMatch(/Il fattorino è in viaggio verso di te/);
    expect(blocco).not.toMatch(/rider/i);
    expect(src).toMatch(/Il fattorino ne ha bisogno per chiudere la consegna\./);
  });

  it('l’email dell’ordine pronto, html e testo, dice «un fattorino passa a prenderlo»', () => {
    const src = leggi('lib/email/templates.ts');
    const inizio = src.indexOf('const corpoConsegna');
    const fine = src.indexOf('orderUrl}`,', inizio);
    const blocco = src.slice(inizio, fine);
    expect(blocco.match(/un fattorino passa a prenderlo/g)?.length).toBe(2);
    expect(blocco).not.toMatch(/un rider passa a prenderlo/);
  });
});
