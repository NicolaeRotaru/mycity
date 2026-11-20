import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// eslint 8 non ha i suoi tipi qui: se ne descrive solo la parte che serve.
type Messaggio = { ruleId: string | null; severity: number; message: string };
type MotoreEslint = {
  lintText(testo: string, opzioni: { filePath: string }): Promise<Array<{ messages: Messaggio[] }>>;
};
const { ESLint } = createRequire(__filename)('eslint') as {
  ESLint: new (opzioni: { cwd: string; cache: boolean }) => MotoreEslint;
};

const ROOT = join(__dirname, '..', '..');
const CAMPIONE = 'export const x: any = 1;\n';
const REGOLA = '@typescript-eslint/no-explicit-any';

async function messaggi(filePath: string, testo = CAMPIONE) {
  const eslint = new ESLint({ cwd: ROOT, cache: false });
  const [r] = await eslint.lintText(testo, { filePath: join(ROOT, filePath) });
  return r.messages.filter((m) => m.ruleId === REGOLA);
}

// R05-001 — la regola sui tipi «qualunque» e' accesa con la configurazione del deposito.
describe('R05-001 il tipo qualunque (any) non passa piu in silenzio', () => {
  it('in un file nuovo di lib/ e un ERRORE', async () => {
    const m = await messaggi('lib/un-file-nuovo-di-prova.ts');
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe(2);
    expect(m[0].message).toMatch(/Unexpected any/);
  });

  it('in un file di components/ e in uno di app/ e un errore', async () => {
    expect((await messaggi('components/UnaCosaNuova.tsx'))[0]?.severity).toBe(2);
    expect((await messaggi('app/api/nuova/route.ts'))[0]?.severity).toBe(2);
  });

  it('nei file che hanno ancora degli any resta un avviso (elenco da svuotare), non un errore', async () => {
    const m = await messaggi('lib/coupons.ts');
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe(1);
  });

  it('un permesso scritto nel punto giusto salta davvero il controllo', async () => {
    const m = await messaggi(
      'lib/un-file-nuovo-di-prova.ts',
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const x: any = 1;\n',
    );
    expect(m).toHaveLength(0);
  });
});
