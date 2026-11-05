import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/** S03 — il lavoro della copia notturna (schede 2425, 2672, 1854, 1851). Lettura del YAML vero. */
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (t: string) => unknown };
type Passo = { name?: string; 'timeout-minutes'?: number; env?: Record<string, string>; if?: string };
type Lavoro = { 'timeout-minutes'?: number; if?: string; needs?: string | string[]; steps: Passo[] };
const lavori = (yaml.load(readFileSync('.github/workflows/backup-db.yml', 'utf8')) as { jobs: Record<string, Lavoro> }).jobs;
const passo = (l: string, nome: string) => lavori[l].steps.find((p) => p.name === nome)!;

describe('copia notturna e prova di ripristino', () => {
  it('2425 e 2672 — ogni passo lungo ha un tetto suo, e la somma sta sotto il tetto del lavoro', () => {
    const lunghi: Record<string, string[]> = {
      backup: ['Esegui il backup', 'Copia le foto accanto al database'],
      'prova-di-ripristino': ['Fai una copia fresca', 'Copia le foto accanto al database', 'Riaprila su un database vuoto, e cronometra'],
    };
    for (const [l, nomi] of Object.entries(lunghi)) {
      const tetti = nomi.map((n) => passo(l, n)['timeout-minutes']);
      expect(tetti.every((t) => typeof t === 'number'), `${l}: un passo lungo senza tetto`).toBe(true);
      const somma = (tetti as number[]).reduce((a, b) => a + b, 0);
      expect(somma, `${l}: un passo appeso farebbe annullare il lavoro, e l'allarme tacerebbe`).toBeLessThan(lavori[l]['timeout-minutes']!);
    }
  });

  it('1854 — il primo del mese la copia non gira due volte, e la prova aspetta la copia', () => {
    expect(lavori.backup.if).toMatch(/github\.event\.schedule != '41 3 1 \* \*'/);
    expect(lavori['prova-di-ripristino'].needs).toBe('backup');
    expect(lavori['prova-di-ripristino'].if).toMatch(/!cancelled\(\)/);
  });

  it('1851 — con le foto configurate a metà lo script lo sa, e dice la causa vera', () => {
    expect(passo('backup', 'Esegui il backup').env?.FOTO_A_META).toMatch(/steps\.foto\.outcome == 'failure'/);
    expect(passo('prova-di-ripristino', 'Fai una copia fresca').env?.FOTO_A_META).toMatch(/steps\.foto\.outcome == 'failure'/);
    const script = readFileSync('scripts/backup-db.sh', 'utf8');
    expect(script).toMatch(/if \[\[ "\$\{FOTO_A_META:-\}" == "si" \]\]; then[\s\S]{0,400}configurata a meta'/);
  });
});
