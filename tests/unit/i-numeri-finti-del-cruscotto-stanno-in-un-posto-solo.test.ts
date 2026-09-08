import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 8/9/2026 — TRE COPIE DIMENTICATE HANNO FERMATO UNA CONSEGNA.
 *
 * Il cruscotto del negoziante si prova montandolo per davvero, e per montarlo
 * gli si passa una risposta finta della lettura `['seller','stats']`. Sette
 * prove lo facevano, e ognuna quella risposta se la scriveva a mano: sette
 * copie della stessa forma, nessuna legata all'altra.
 *
 * Quel giorno le quattro targhette in cima sono passate da numero grezzo a
 * oggetto già deciso (`{valore, nota, guasto}`). Quattro copie sono state
 * aggiornate, tre no. Risultato: otto prove rosse con
 * «Cannot read properties of undefined (reading 'guasto')» su una modifica che
 * il prodotto ce l'aveva giusta. Non era rotto il cruscotto: era rotta la copia
 * finta, e nessuno poteva accorgersene prima di far girare tutto.
 *
 * Adesso la risposta finta la costruisce un posto solo —
 * `tests/unit/aiuti/cruscotto-del-negozio.ts` — chiamando le funzioni vere di
 * `lib/letture-cruscotto`. Questa prova tiene chiusa la porta da cui è entrato
 * il difetto: se domani una prova nuova si riscrive la sua copia, diventa rossa
 * qui, subito, invece di stare zitta fino al giorno in cui la forma cambia.
 *
 * QUELLO CHE QUESTA PROVA NON PUÒ FARE: legge il testo dei file, non li esegue.
 * Riconosce una copia scritta come si scrivono le altre; non riconoscerebbe una
 * copia costruita in un modo che non somiglia a nessuna di queste. È un freno
 * sull'abitudine — la cosa che è successa davvero — non una dimostrazione.
 */

const CARTELLA = join(process.cwd(), 'tests/unit');
const AIUTO = 'tests/unit/aiuti/cruscotto-del-negozio.ts';

/**
 * Chi installa una risposta finta per la lettura `['seller','stats']` — e SOLO per quella.
 *
 * La prima stesura cercava `queryKey[1] === 'stats'` e basta. Ha bocciato una prova del cruscotto
 * **dell'amministrazione**, che finge `['admin','stats']`: un'altra lettura, un'altra forma, niente
 * a che vedere con le targhette del negoziante. Un guardiano che boccia lavoro legittimo si
 * disattiva da solo dopo la seconda volta, quindi le due metà si pretendono insieme.
 */
const INSTALLA_LA_FINTA =
  /queryKey\[0\]\s*===\s*'seller'[\s\S]{0,120}?queryKey\[1\]\s*===\s*'stats'|queryKey:\s*\[\s*'seller',\s*'stats'\s*\]/;

describe('la risposta finta del cruscotto del negozio', () => {
  it('la costruisce un posto solo, e chiama le funzioni vere', () => {
    const aiuto = readFileSync(join(process.cwd(), AIUTO), 'utf8');
    expect(
      aiuto.match(INSTALLA_LA_FINTA),
      `${AIUTO} non installa più la lettura finta: questa prova non guarda più niente`,
    ).toBeTruthy();
    for (const funzione of [
      'targhettaNetto', 'targhettaProdotti', 'targhettaValutazione', 'targhettaArticoli',
    ]) {
      expect(
        aiuto.includes(`${funzione}(`),
        `l'aiuto non chiama più ${funzione}: se la targhetta se la scrive da sé, torna a poter mentire`,
      ).toBe(true);
    }
  });

  it('e nessuna prova se la riscrive per conto suo', () => {
    const copie = readdirSync(CARTELLA)
      .filter((n) => n.endsWith('.test.ts'))
      .filter((n) => n !== 'i-numeri-finti-del-cruscotto-stanno-in-un-posto-solo.test.ts')
      .filter((n) => INSTALLA_LA_FINTA.test(readFileSync(join(CARTELLA, n), 'utf8')));

    expect(
      copie,
      `Queste prove si costruiscono la loro copia della risposta del cruscotto: ${copie.join(', ')}.\n` +
      `Il giorno in cui la forma cambia, si aggiornano le altre e queste restano indietro — è già successo,\n` +
      `l'8/9/2026, e sono costate otto prove rosse. Usa statisticheDelCruscotto() da ${AIUTO}.`,
    ).toEqual([]);
  });
});
