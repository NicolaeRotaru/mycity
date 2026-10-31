import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 31/10/2026 — LA PORTA DEL CATALOGO NON PROMETTE PIU' DI QUELLO CHE FA.
 *
 * Il commento di `salvataggio-tracciato.ts` diceva «la regola scende sul DATO»
 * e «una porta nuova o passa di qui, o non scrive», e accanto al controllo
 * della scheda «da nessuna porta». Non era vero: la regola per riga che lascia
 * il venditore scrivere `products` dal browser e' ancora in piedi, e il
 * caricamento da file inserisce prodotti in vendita senza passare di qui. Chi
 * legge quel commento crede che il buco sia chiuso e non lo cerca.
 *
 * La prova lega la promessa ai fatti: finche' la regola per riga c'e' e il
 * caricamento scrive diretto, il commento non puo' dire il contrario.
 */

const radice = process.cwd();
const leggi = (rel: string) => readFileSync(join(radice, rel), 'utf8');
const porta = leggi('lib/products/salvataggio-tracciato.ts');

describe('la porta del catalogo dice il vero su di se\'', () => {
  it('finche\' il browser puo\' scrivere products, non promette di essere l\'unica porta', () => {
    const migrazioni = readdirSync(join(radice, 'migrations')).filter((f) => f.endsWith('.sql'));
    const revocata = migrazioni.some((f) =>
      /DROP\s+POLICY\s+(IF\s+EXISTS\s+)?"Sellers can update their own products"/i.test(leggi(join('migrations', f))),
    );
    if (revocata) return;
    expect(porta, 'promette che una porta nuova «o passa di qui, o non scrive»').not.toMatch(/o passa di qui, o non scrive/);
    expect(porta, 'promette che la regola sta sul dato').not.toMatch(/la\s*\n?\s*\*?\s*regola scende sul DATO/);
  });

  it('finche\' il caricamento da file inserisce diretto, non dice «da nessuna porta»', () => {
    const caricamento = leggi('app/seller/products/import/page.tsx');
    if (!/from\('products'\)\.insert\(/.test(caricamento)) return;
    expect(porta, 'dice che una scheda incompleta non entra in vetrina «da nessuna porta»').not.toMatch(/da nessuna porta/);
  });
});
