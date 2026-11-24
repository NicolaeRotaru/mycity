/**
 * La nota in cima al cron delle notifiche (app/api/cron/send-push/route.ts, sopra le categorie che
 * possono aspettare: quanto vale un avviso, quale sostituisce sul telefono, chi le usa) portava
 * l'id della voce di un'altra sessione. Un id di voce o di sessione dentro un commento non dice
 * niente a chi legge il codice, e fa scattare i controlli dei rami. Prova leggera sul sorgente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sorgente = readFileSync(join(process.cwd(), 'app', 'api', 'cron', 'send-push', 'route.ts'), 'utf8');

/** I commenti fra l'ultima importazione e le categorie che possono aspettare. */
const nota = (() => {
  const dopoImport = sorgente.slice(sorgente.lastIndexOf('\nimport '));
  const inizio = dopoImport.indexOf('\n', dopoImport.indexOf(';')) + 1;
  const fine = dopoImport.indexOf('/** Le categorie che possono aspettare');
  return dopoImport.slice(inizio, fine);
})();

/** Un codice di voce: una lettera, due cifre, un trattino, tre cifre. */
const CODICE_DI_VOCE = /\b[A-Z]\d{2}-\d{3}\b/;
/** Un codice di sessione: R e due o tre cifre, da solo o davanti al numero della voce. */
const CODICE_DI_SESSIONE = /\bR\d{2,3}\b/;

describe('la nota in cima al cron delle notifiche', () => {
  it('c è ancora, e parla delle regole della push', () => {
    expect(nota).toMatch(/CONSEGNA_PER_CATEGORIA/);
    expect(nota).toMatch(/contrassegno/);
  });

  it('non porta codici di voce né di sessione', () => {
    expect(nota, 'nel commento resta un codice di voce').not.toMatch(CODICE_DI_VOCE);
    expect(nota, 'nel commento resta un codice di sessione').not.toMatch(CODICE_DI_SESSIONE);
  });
});
