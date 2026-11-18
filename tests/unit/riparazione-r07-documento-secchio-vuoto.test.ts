import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R07-004 — Il documento della copia notturna diceva ancora «Un singolo secchio vuoto resta
 * legittimo»: la regola di prima di R15-004. Lo script oggi distingue il secchio vuoto da sempre
 * (verde) da quello che aveva file (rosso se il database ne elenca ancora, o se e' `products` o
 * `stories`, che l'app non svuota mai; verde con avviso per `reviews` svuotato dall'app), con una
 * memoria fra le notti che si toglie a mano. Prova leggera: il testo, confrontato con lo script.
 */
const ROOT = process.cwd();
const doc = readFileSync(join(ROOT, 'docs', 'backup-restore.md'), 'utf8').replace(/\s+/g, ' ');
const script = readFileSync(join(ROOT, 'scripts', 'backup-db.sh'), 'utf8');

describe('R07-004 · il documento dice quando un secchio vuoto e\' legittimo, come lo script', () => {
  it('non dice piu\' che un secchio vuoto e\' sempre legittimo', () => {
    expect(doc).not.toContain('Un singolo secchio vuoto resta legittimo');
    expect(doc).toContain('**vuoto da sempre** va bene');
  });

  it('il secchio che aveva file e il database che ne elenca ancora: rosso', () => {
    expect(doc).toContain('**vuoto nella copia mentre il database ne elenca ancora file** è rosso');
    expect(doc).toMatch(/\*\*aveva file e adesso è vuoto anche nel database\*\* è rosso se è `products` o `stories`/);
  });

  it('reviews svuotato dall\'app e\' verde con avviso, ed e\' fra i secchi che lo script lascia svuotare', () => {
    expect(doc).toMatch(/Se è `reviews`, che l'app svuota da sola[^.]*, la notte è verde con un avviso/);
    const svuotatiDallApp = script.match(/^SECCHI_SVUOTATI_DALL_APP="([^"]*)"/m)?.[1].split(/\s+/) ?? [];
    expect(svuotatiDallApp).toContain('reviews');
    expect(svuotatiDallApp).not.toContain('products');
    expect(svuotatiDallApp).not.toContain('stories');
  });

  it('dice quale file togliere a mano, con il nome che usa lo script', () => {
    expect(script).toContain('MEMORIA_COPIA="${DEST_PULITA}/_memoria-copia"');
    expect(script).toContain('${MEMORIA_COPIA}/${secchio}.aveva-file');
    expect(doc).toContain('`<destinazione>/_memoria-copia/<secchio>.aveva-file`');
    expect(doc).toMatch(/Se lo svuotamento di `products` o `stories` è voluto, quel file si toglie a mano/);
  });
});
