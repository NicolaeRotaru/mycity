import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R09-005 — Il conto del carrello a schermo ha una fonte sola: `riepilogoDaMostrare`.
 *
 * components/checkout/useTotaliCarrello.ts (`calcolaTotali`) era una seconda copia del conto che
 * nessuna pagina importava, con parole di significato diverso («totale» prima del credito, il
 * credito anche con la carta). Due prove della consegna confrontavano proprio quella copia col
 * server: restavano verdi qualunque cosa succedesse allo schermo vero. La copia è cancellata e le
 * prove guardano il riepilogo che la cassa mostra.
 */

const radice = join(__dirname, '..', '..');
const leggi = (p: string) => readFileSync(join(radice, p), 'utf8');

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(radice, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    const st = statSync(join(radice, rel));
    if (st.isDirectory()) sorgenti(rel, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

describe('R09-005 — il conto della cassa ha una copia sola', () => {
  it('la copia orfana components/checkout/useTotaliCarrello.ts non esiste più', () => {
    expect(existsSync(join(radice, 'components/checkout/useTotaliCarrello.ts'))).toBe(false);
  });

  it('nessun file di app, components, lib o tests importa la copia orfana', () => {
    const chi = ['app', 'components', 'lib', 'tests']
      .flatMap((d) => sorgenti(d))
      .filter((f) => /from\s+['"][^'"]*checkout\/useTotaliCarrello['"]/.test(leggi(f)));
    expect(chi).toEqual([]);
  });

  it('la cassa mostra riepilogoDaMostrare', () => {
    const cassa = leggi('app/checkout/page.tsx');
    expect(cassa).toMatch(/import\s*\{[^}]*\briepilogoDaMostrare\b[^}]*\}\s*from\s*'@\/lib\/ordini\/riepilogo-cassa'/);
    expect(cassa).toMatch(/riepilogoDaMostrare\(\{/);
  });

  it.each([
    'tests/unit/la-consegna-costa-3-o-4-euro-per-negozio.test.ts',
    'tests/unit/la-consegna-e-una-sola-per-tutto-il-carrello.test.ts',
  ])('%s confronta col server lo schermo vero (riepilogoDaMostrare), anche la consegna', (prova) => {
    const src = leggi(prova);
    expect(src).not.toMatch(/calcolaTotali\(/);
    expect(src).toMatch(/riepilogoDaMostrare\(/);
    expect(src).toMatch(/cassa\.feeConsegna \* 100\) !== server\.grandDeliveryFeeCents/);
  });

  it('ogni modulo di components/checkout è importato da almeno un altro file (niente copie orfane)', () => {
    const tutti = ['app', 'components', 'lib'].flatMap((d) => sorgenti(d));
    const orfani = readdirSync(join(radice, 'components/checkout'))
      .filter((n) => /\.(ts|tsx)$/.test(n))
      .filter((n) => {
        const base = n.replace(/\.tsx?$/, '');
        const sePropria = join('components/checkout', n);
        const re = new RegExp(`from\\s+['"](?:@/components/checkout/|\\./)${base}['"]`);
        return !tutti.some((f) => f !== sePropria && re.test(leggi(f)));
      });
    expect(orfani).toEqual([]);
  });
});
