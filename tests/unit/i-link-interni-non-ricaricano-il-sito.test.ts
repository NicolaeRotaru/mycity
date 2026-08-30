/**
 * 27/8/2026 (R099) — DUE LINK INTERNI SCRITTI COME LINK ESTERNI.
 *
 * `<a href="/…">` non è `<Link href="/…">`: il primo butta via la pagina e la ricarica da capo. I
 * due punti dove capitava erano i peggiori possibili, perché stavano dentro un modulo mezzo
 * compilato:
 *
 *  · sotto l'iscrizione alla newsletter, il link «Privacy Policy» — chi lo apre per leggere prima
 *    di iscriversi torna indietro e trova il campo email vuoto, e ricomincia;
 *  · nella pagina di accesso, il link «Contatti» dentro il messaggio che compare quando il
 *    controllo anti-bot non si carica: email e password battute se ne vanno.
 *
 * Più il paio di secondi di ricaricamento intero su rete mobile.
 *
 * Questa prova legge il sito com'è adesso: è un invariante di struttura, e il numero deve restare
 * zero. Non può montare le pagine — in questa repo i componenti React non si montano dentro una
 * prova — ma il difetto è nel codice sorgente, e nel codice sorgente si vede.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

function ancoreInterne(): string[] {
  const cmd = 'grep -rn \'<a [^>]*href="/\' app/ components/ || true';
  return execSync(cmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

describe('i link verso pagine del sito', () => {
  it('passano tutti da next/link, nessuno ricarica il sito da capo', () => {
    expect(ancoreInterne(), 'un link interno scritto come esterno: chi lo apre perde quello che aveva scritto').toEqual([]);
  });

  it('il conto delle pagine guardate non è zero: senza, questa regola non misura niente', () => {
    // Una ricerca che non trova più niente passerebbe qualunque regola. Questa riga muore il giorno
    // in cui la ricerca smette di funzionare, invece di dire verde per sbaglio.
    const quanti = Number(execSync('grep -rl "href=" app/ components/ | wc -l', { encoding: 'utf8' }).trim());
    expect(quanti).toBeGreaterThan(50);
  });
});
