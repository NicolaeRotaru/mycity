import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #44 — `lib/notifications.ts` non poteva funzionare, e nessuno lo sapeva.
 *
 * La funzione `notify()` inseriva una riga in `notifications` dal browser, per
 * conto di un ALTRO utente. La tabella non ha (e non deve avere) una regola che
 * lo permetta: il database rifiutava, e la funzione si mangiava l'errore con un
 * `catch` silenzioso. Quattro punti del codice sembravano mandare una notifica
 * e non ne mandavano nessuna — mentre il trigger lato server (migrazione 086) la
 * mandava davvero, quindi nemmeno si notava che mancasse.
 *
 * Il file è stato cancellato. Questa prova serve perché non torni: le notifiche
 * si scrivono dal server (trigger o rotta con client di servizio), mai dal
 * browser per conto di terzi.
 */

const RADICE = join(__dirname, '..', '..');

function filesorgente(dir: string, acc: string[] = []): string[] {
  for (const voce of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
    if (voce.name === 'node_modules' || voce.name.startsWith('.')) continue;
    const rel = join(dir, voce.name);
    if (voce.isDirectory()) filesorgente(rel, acc);
    else if (/\.(ts|tsx)$/.test(voce.name)) acc.push(rel);
  }
  return acc;
}

describe('le notifiche non si scrivono dal browser', () => {
  it('lib/notifications.ts non esiste piu\'', () => {
    expect(existsSync(join(RADICE, 'lib/notifications.ts'))).toBe(false);
  });

  it('nessun componente importa una funzione notify() lato browser', () => {
    const colpevoli = ['app', 'components', 'lib']
      .flatMap((d) => filesorgente(d))
      .filter((f) => /from ['"]@\/lib\/notifications['"]/.test(readFileSync(join(RADICE, f), 'utf8')));
    expect(colpevoli).toEqual([]);
  });

  it("nessuna pagina client scrive dentro la tabella notifications", () => {
    const colpevoli = ['app', 'components']
      .flatMap((d) => filesorgente(d))
      .filter((f) => {
        const testo = readFileSync(join(RADICE, f), 'utf8');
        if (!testo.includes("'use client'")) return false;
        return /from\(['"]notifications['"]\)[\s\S]{0,80}\.insert\(/.test(testo);
      });
    expect(colpevoli).toEqual([]);
  });
});
