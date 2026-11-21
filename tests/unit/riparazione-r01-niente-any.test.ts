import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

// `eslint` non porta i tipi: si descrive qui solo la parte che la prova usa.
type Messaggio = { ruleId: string | null; severity: number; message: string };
type Esito = { messages: Messaggio[] };
type MotoreEslint = { lintText(codice: string, opz: { filePath: string }): Promise<Esito[]> };
const { ESLint } = createRequire(import.meta.url)('eslint') as {
  ESLint: new (opz: { cwd: string; useEslintrc: boolean }) => MotoreEslint;
};

// R01-001 — con la configurazione del deposito, un tipo «qualunque» in un file nuovo sotto lib/ è un
// errore, e un permesso di saltare il controllo che non salta niente viene segnalato.
// La prova usa l'API di ESLint (lintText) sulla .eslintrc.json vera.
function eslint() {
  return new ESLint({ cwd: ROOT, useEslintrc: true });
}

describe('R01-001 il lint non lascia passare i tipi qualunque', () => {
  it('un any in un file nuovo sotto lib/ è un errore', async () => {
    const [r] = await eslint().lintText('export function f(x: any) { return x; }\n', {
      filePath: join(ROOT, 'lib', 'file-finto-r01.ts'),
    });
    const m = r.messages.find((x) => x.ruleId === '@typescript-eslint/no-explicit-any');
    expect(m).toBeDefined();
    expect(m?.severity).toBe(2);
  }, 60000);

  it('un permesso di saltare il controllo che non salta niente viene segnalato', async () => {
    const [r] = await eslint().lintText(
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const n: number = 1;\n',
      { filePath: join(ROOT, 'lib', 'file-finto-r01.ts') },
    );
    expect(r.messages.some((x) => /Unused eslint-disable directive/.test(x.message))).toBe(true);
  }, 60000);
});
