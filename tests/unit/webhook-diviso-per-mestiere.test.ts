import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #12 — IL GESTORE DEI PAGAMENTI ERA UN FILE SOLO DA MILLE RIGHE CON DENTRO
 * OTTO MESTIERI.
 *
 * Creazione ordini, buoni regalo, spazi sponsorizzati, abbonamenti dei
 * venditori, rimborsi, contestazioni carta, storni di bonifico, esiti dei
 * pagamenti: tutto nello stesso posto. Ogni modifica ai buoni regalo si
 * portava dietro il rischio di toccare la creazione degli ordini, perché la
 * revisione mostrava un diff dentro un blocco da mille righe — sulla strada
 * su cui passano tutti i soldi del marketplace.
 *
 * Questa prova non guarda la bellezza del codice: guarda che il confine
 * regga. Se qualcuno rimette un gestore dentro la rotta, torna rossa.
 */

const ROTTA = join(process.cwd(), 'app/api/stripe/webhook/route.ts');
const CARTELLA = join(process.cwd(), 'lib/stripe/webhook');

describe('il webhook Stripe è diviso per mestiere', () => {
  it('la rotta fa solo firma, anti-doppione e smistamento', () => {
    const rotta = readFileSync(ROTTA, 'utf8');
    const righe = rotta.split('\n').length;
    expect(righe).toBeLessThan(250);

    // Le tre cose che devono restare.
    expect(rotta).toContain('constructEvent');
    expect(rotta).toContain('stripe_event_log');
    expect(rotta).toContain('switch (event.type)');
  });

  it('nessun gestore è rimasto dentro la rotta', () => {
    const rotta = readFileSync(ROTTA, 'utf8');
    // I gestori si importano, non si definiscono qui.
    const definizioni = rotta.match(/^async function handle/gm) ?? [];
    expect(definizioni.length).toBe(0);
  });

  it('ogni mestiere ha il suo file, e nessuno è di nuovo enorme', () => {
    const file = readdirSync(CARTELLA).filter((f) => f.endsWith('.ts'));
    expect(file.length).toBeGreaterThanOrEqual(8);
    for (const f of file) {
      const righe = readFileSync(join(CARTELLA, f), 'utf8').split('\n').length;
      expect(righe, `${f} è tornato troppo grande`).toBeLessThan(600);
    }
  });

  it('il controllo anti-doppione marca l evento DOPO il gestore, non prima', () => {
    // È la parte fatta bene, ed è quella facile da rompere spostando il
    // codice: se l'evento si marcasse come lavorato prima, un gestore fallito
    // non verrebbe mai riprovato da Stripe e l'ordine sparirebbe.
    const rotta = readFileSync(ROTTA, 'utf8');
    const smistamento = rotta.indexOf('switch (event.type)');
    const marcatura = rotta.indexOf("processed: true");
    expect(smistamento).toBeGreaterThan(0);
    expect(marcatura).toBeGreaterThan(smistamento);
  });
});
