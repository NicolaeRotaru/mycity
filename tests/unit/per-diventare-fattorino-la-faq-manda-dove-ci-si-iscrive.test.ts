import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — LA FAQ MANDAVA A UNA CASELLA DI POSTA MENTRE L'ISCRIZIONE C'ERA GIÀ.
 *
 * Alla domanda «Come faccio a consegnare per MyCity?» la risposta era: «scrivi
 * a info@mycity.it con oggetto Candidatura Rider, ti contatteremo entro 48h».
 *
 * Due cose non andavano.
 *
 * ① Quell'indirizzo sta su `mycity.it`, che NON è il dominio dove vive il sito
 *    (`mycity-marketplace.com`): sono due caselle di posta diverse, su due
 *    servizi diversi. Il codice stesso tratta quel dominio come ripiego —
 *    `lib/legal/titolare.ts` chiama «ripiego» privacy@mycity.it, e un commento
 *    del giro degli allarmi tratta admin@mycity.it come indirizzo inventato.
 *    Chi scrive non sa se qualcuno legge.
 *
 * ② Più serio: l'iscrizione dei fattorini ESISTE ed è automatica. La pagina
 *    «Lavora con noi» manda già a `/sign-up?role=rider`, e da lì si caricano
 *    documento, patente e polizza. La FAQ mandava invece ad aspettare una
 *    risposta che nessuno si era impegnato a dare: le «48h» non le garantiva
 *    nessun processo.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Non è la prova che chiude tutto il difetto: gli indirizzi su quel dominio nel
 * sito sono diciotto, sparsi in file che questa squadra non tocca, e quale sia
 * il dominio vero lo deve dire Nicola. Questa rete tiene fermo il pezzo che si
 * poteva chiudere: la FAQ non manda più nessuno a una casella di posta, e la
 * strada che indica al suo posto ESISTE DAVVERO — la pagina di iscrizione c'è e
 * accetta il ruolo «rider». Una promessa e chi la mantiene, controllati insieme.
 *
 * ⚪ Da qui non ho potuto verificare chi possiede mycity.it: il filtro di rete
 * blocca quel dominio. Non dico quindi se quelle caselle siano nostre.
 */

const RADICE = process.cwd();
const FAQ = readFileSync(join(RADICE, 'app/faq/page.tsx'), 'utf8');

/** Il testo che l'utente legge davvero: senza i commenti, che restano al programmatore. */
function senzaCommenti(sorgente: string): string {
  return sorgente
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((r) => !r.trim().startsWith('//'))
    .join('\n');
}

describe('la FAQ non manda più nessuno a una casella di posta', () => {
  it('nel testo della pagina non c’è nessun indirizzo email', () => {
    const visibile = senzaCommenti(FAQ);
    const indirizzi = [...visibile.matchAll(/[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
    expect(
      indirizzi,
      `la FAQ manda a ${indirizzi.join(', ')}: se quella casella non è nostra, chi scrive non riceve risposta e non lo sa`,
    ).toEqual([]);
    expect(visibile, 'nessun collegamento «scrivi a…» nella FAQ').not.toMatch(/mailto:/);
  });

  it('non promette più un tempo di risposta che nessuno garantisce', () => {
    expect(senzaCommenti(FAQ), 'le «48h» non le garantiva nessun processo').not.toMatch(/48\s*h/i);
  });
});

describe('la strada che la FAQ indica al fattorino esiste davvero', () => {
  it('la risposta manda alla pagina di iscrizione col ruolo già scelto', () => {
    const sezione = FAQ.slice(FAQ.indexOf("title: 'Diventare rider'"));
    const rotta = sezione.match(/href="(\/sign-up\?role=rider)"/)?.[1];
    expect(rotta, 'la FAQ non dice più dove ci si iscrive come fattorino').toBe('/sign-up?role=rider');
  });

  it('quella pagina c’è, e il ruolo «rider» lo accetta', () => {
    const percorso = join(RADICE, 'app/sign-up/page.tsx');
    expect(existsSync(percorso), 'la FAQ manda a una pagina che non esiste').toBe(true);
    const iscrizione = readFileSync(percorso, 'utf8');
    // La pagina legge il ruolo dall'indirizzo e «rider» è fra quelli buoni: se
    // domani sparisse, la FAQ manderebbe su una pagina che ignora la richiesta.
    expect(iscrizione, 'la pagina di iscrizione non legge più il ruolo dall’indirizzo').toMatch(
      /searchParams\.get\('role'\)/,
    );
    expect(iscrizione, 'il ruolo «rider» non è più fra quelli accettati').toMatch(/'rider'/);
  });

  it('è la stessa strada che indica già «Lavora con noi»: una sola, non due', () => {
    const lavora = readFileSync(join(RADICE, 'app/lavora-con-noi/page.tsx'), 'utf8');
    expect(
      lavora,
      'le due pagine mandano il fattorino in due posti diversi',
    ).toContain('/sign-up?role=rider');
  });
});
