/**
 * 17/11/2026 — IL NOME DI UNA PROVA DICE QUELLO CHE LA PROVA CONTROLLA.
 *
 * In `le-funzioni-spente-al-lancio-le-rifiuta-il-server.test.ts` il caso del Drop si chiamava
 * «… anche senza chiave di servizio», ma il middleware è finto e `getAdminSupabase` risponde: la
 * prova controlla solo che il gestore si fermi (409) PRIMA di chiedere la chiave di servizio. Nella
 * rotta vera, senza chiave, risponde 503 già `withAdminAuth`, prima del freno. Il nome prometteva
 * una cosa che la prova non guarda.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(process.cwd(), 'tests/unit/le-funzioni-spente-al-lancio-le-rifiuta-il-server.test.ts');

/** I casi del file: nome e corpo fino al caso successivo. */
function casi(): Array<{ nome: string; corpo: string }> {
  const testo = readFileSync(FILE, 'utf8');
  const pezzi = [...testo.matchAll(/\bit\('((?:\\'|[^'])*)'/g)];
  return pezzi.map((m, i) => ({
    nome: m[1],
    corpo: testo.slice(m.index! + m[0].length, i + 1 < pezzi.length ? pezzi[i + 1].index : undefined),
  }));
}

describe('la prova del Drop spento si chiama per quello che controlla', () => {
  it('il caso del pannello admin non promette «senza chiave di servizio» e nomina il punto in cui si ferma', () => {
    const drop = casi().filter((c) => c.corpo.includes('salvaDrop('));
    expect(drop.length, 'non trovo il caso che chiama la rotta del Drop').toBe(1);
    const [{ nome, corpo }] = drop;
    // Il caso controlla proprio questo: 409, nessuna scrittura, getAdminSupabase mai chiesto.
    expect(corpo).toMatch(/toBe\(409\)/);
    expect(corpo).toMatch(/expect\(chiesto[^)]*\)\.toBe\(false\)/);
    expect(nome, 'il middleware è finto: la prova non chiama mai la rotta senza chiave di servizio').not.toMatch(/senza chiave/i);
    expect(nome).toMatch(/prima di chiedere getAdminSupabase/);
    expect(nome).toMatch(/middleware finto/);
  });
});
