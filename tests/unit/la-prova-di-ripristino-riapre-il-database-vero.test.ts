import { describe, it, expect } from 'vitest';
import { scegliCopie } from '@/scripts/copie-di-backup.mjs';

/**
 * LA PROVA MENSILE RIAPRIVA IL FILE SBAGLIATO.
 *
 * Radiografia del 27/8/2026 (R179). Il backup notturno scrive due file cifrati
 * nella stessa cartella e nello stesso secondo: il database vero e la sola
 * tabella degli utenti. La prova di ripristino li sceglieva con «il piu'
 * recente», e quale dei due sia il piu' recente, fra due file nati a meno di un
 * secondo di distanza, non lo decide nessuno.
 *
 * Poteva quindi riaprire trecento righe di utenti e dichiarare riuscito il
 * ripristino del database. Una copia di sicurezza non provata non e' una copia
 * di sicurezza: e' una speranza — e questa e' la riga che scopre che era una
 * speranza.
 */

const NOTTE = [
  'backup/mycity_20260827T0217Z.dump.gpg',
  'backup/mycity_20260827T0217Z_utenti.dump.gpg',
];

describe('quale copia si riapre nella prova di ripristino', () => {
  it('la principale e il database, mai la tabella degli utenti', () => {
    const { principale } = scegliCopie(NOTTE);
    expect(principale).toBe('backup/mycity_20260827T0217Z.dump.gpg');
    expect(
      principale,
      'la prova riapre il dump degli utenti e si dichiara soddisfatta senza aver toccato il database',
    ).not.toContain('_utenti');
  });

  it('anche se gli utenti sono elencati per primi', () => {
    // L'ordine dell'elenco non deve contare: e' esattamente la fragilita' che
    // ha causato il difetto.
    const { principale } = scegliCopie([...NOTTE].reverse());
    expect(principale).toBe('backup/mycity_20260827T0217Z.dump.gpg');
  });

  it('restituisce anche gli utenti: un ripristino completo li vuole entrambi', () => {
    const { utenti } = scegliCopie(NOTTE);
    expect(utenti).toBe('backup/mycity_20260827T0217Z_utenti.dump.gpg');
  });

  it('prende la notte piu recente quando la cartella ne tiene tante', () => {
    const settimana = [
      'backup/mycity_20260825T0217Z.dump.gpg',
      'backup/mycity_20260825T0217Z_utenti.dump.gpg',
      'backup/mycity_20260827T0217Z.dump.gpg',
      'backup/mycity_20260827T0217Z_utenti.dump.gpg',
      'backup/mycity_20260826T0217Z.dump.gpg',
      'backup/mycity_20260826T0217Z_utenti.dump.gpg',
    ];
    const scelte = scegliCopie(settimana);
    expect(scelte.data).toBe('20260827T0217Z');
    expect(scelte.principale).toContain('20260827');
    expect(scelte.utenti).toContain('20260827');
  });

  it('database e utenti vengono dalla stessa notte, mai mescolati', () => {
    // Riaprire il database di ieri con gli utenti di oggi darebbe uno stato che
    // non e' mai esistito: ordini che appartengono a nessuno.
    const scelte = scegliCopie([
      'backup/mycity_20260826T0217Z.dump.gpg',
      'backup/mycity_20260827T0217Z.dump.gpg',
      'backup/mycity_20260826T0217Z_utenti.dump.gpg',
    ]);
    expect(scelte.principale).toContain('20260827');
    expect(scelte.utenti, 'gli utenti di un altra notte non sono la coppia di questo database').toBeNull();
  });

  it('una cartella vuota non finge di avere una copia', () => {
    expect(scegliCopie([])).toEqual({ principale: null, utenti: null, data: null });
    expect(scegliCopie(['backup/README.md']).principale).toBeNull();
  });

  it('funziona anche sui file non cifrati, che e come nascono', () => {
    const { principale, utenti } = scegliCopie([
      'backup/mycity_20260827T0217Z.dump',
      'backup/mycity_20260827T0217Z_utenti.dump',
    ]);
    expect(principale).toBe('backup/mycity_20260827T0217Z.dump');
    expect(utenti).toBe('backup/mycity_20260827T0217Z_utenti.dump');
  });
});
