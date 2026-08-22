import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 22/8/2026 — LE PAGINE PRIVATE FINIVANO NELLA CACHE DEL BROWSER.
 *
 * Il service worker metteva in cache OGNI pagina servita con successo, comprese
 * quelle dietro l'accesso: i propri ordini, il profilo, la dashboard del
 * negozio, il pannello di amministrazione.
 *
 * Non è una fuga verso internet: è una fuga verso la persona seduta dopo di te.
 * Su un computer condiviso, o dopo un cambio di account sullo stesso browser,
 * quelle pagine tornano fuori dalla cache a chi non le doveva vedere.
 *
 * E con la rete assente, un'immagine non ancora in cache faceva restituire
 * `undefined` a `respondWith`, che lancia: una foto mancante diventava un pezzo
 * di pagina rotto.
 *
 * Il service worker è un file a sé, servito così com'è: non si può importare in
 * una prova. Qui si legge il file e si controllano le due difese — ed è
 * dichiarato, non spacciato per una prova di comportamento.
 */

const SW = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');

describe('il service worker non tiene in cache quello che è di uno solo', () => {
  it('conosce i percorsi privati, tutti', () => {
    for (const p of ['/orders', '/profile', '/seller', '/rider', '/admin', '/checkout']) {
      expect(SW, `manca ${p} fra i percorsi privati`).toContain(`'${p}'`);
    }
  });

  it('la funzione che decide c’è, e la cache HTML la interroga', () => {
    expect(SW).toContain('function ePrivata');
    // Il `cache.put` dell'HTML deve essere sotto condizione.
    const i = SW.indexOf('async function networkFirstHtml');
    const blocco = SW.slice(i, SW.indexOf('}', SW.indexOf('return caches.match(OFFLINE_URL)', i)));
    expect(blocco).toContain('!privata');
  });

  it('con la rete giù e l’immagine non in cache si risponde, non si lancia', () => {
    // `respondWith(undefined)` lancia, e in alcuni browser fa saltare la
    // gestione dell'intera richiesta.
    expect(SW).toContain('Response.error()');
    expect(SW).not.toMatch(/\.catch\(\(\) => cached\);/);
  });

  it('il controllo guarda un file vero, non una stringa vuota', () => {
    expect(SW.length).toBeGreaterThan(1000);
    expect(SW).toContain("addEventListener('fetch'");
  });
});
