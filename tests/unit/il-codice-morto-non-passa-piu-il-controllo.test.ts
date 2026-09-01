import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * 30/8/2026 (R013) — NIENTE VIETAVA IL CODICE MORTO: NÉ IL COMPILATORE NÉ IL
 * CONTROLLO DI STILE.
 *
 * `.eslintrc.json` non accendeva `@typescript-eslint/no-unused-vars`, e
 * `tsconfig.json` non ha né `noUnusedLocals` né `noUnusedParameters`. Quindi
 * `npm run verify` restava verde su qualunque cosa fosse rimasta indietro:
 * import orfani, variabili calcolate e mai lette, funzioni che non chiamava
 * più nessuno. Alla prima misura erano quarantadue.
 *
 * Perché conta, che non è la pulizia. Il codice morto non fa danni da solo: fa
 * danni perché chi legge non sa più cosa è vivo. Una variabile che sembra usata
 * fa credere che una regola sia governata da lì mentre gira altrove — ed è così
 * che una riparazione viene fatta da una parte sola. Il caso vero:
 * `app/cart/page.tsx` teneva `const freeShipping = total >= FREE_SHIPPING_THRESHOLD`
 * che nessuno leggeva più, cioè proprio la riga che diceva «Gratis» sul totale
 * sbagliato, lasciata lì a far credere che quella regola fosse ancora viva.
 *
 * Questa prova non legge il file di configurazione: fa girare il controllo VERO
 * su due pezzetti di codice e guarda cosa risponde.
 */

/**
 * `eslint` non porta con sé i suoi tipi in questo progetto, quindi lo si carica
 * a mano dichiarando la forma dei due pezzi che servono. È il controllo VERO,
 * con la configurazione vera del progetto: non una copia semplificata.
 */
type MessaggioLint = { ruleId: string | null; message: string; severity: number };
type Controllo = {
  lintText(codice: string, opzioni: { filePath: string }): Promise<Array<{ messages: MessaggioLint[] }>>;
};
const richiedi = createRequire(import.meta.url);
const { ESLint } = richiedi('eslint') as { ESLint: new (o: { cwd: string }) => Controllo };

const eslint = new ESLint({ cwd: process.cwd() });

async function errori(codice: string, percorso: string): Promise<string[]> {
  const [esito] = await eslint.lintText(codice, { filePath: percorso });
  return (esito?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => `${m.ruleId}: ${m.message}`);
}

describe('il controllo di stile davanti al codice morto', () => {
  it('una variabile calcolata e mai letta non passa', async () => {
    const trovati = await errori(
      'export function conto(prezzo: number) {\n  const scontoMorto = prezzo * 0.1;\n  return prezzo;\n}\n',
      'lib/prova-del-codice-morto.ts',
    );
    expect(
      trovati.join(' · '),
      'una variabile che nessuno legge passa il controllo: chi legge il codice non sa piu cosa e vivo',
    ).toContain('no-unused-vars');
  }, 30000);

  it('e nemmeno un import rimasto indietro', async () => {
    const trovati = await errori(
      "import { readFileSync } from 'node:fs';\nexport const due = 2;\n",
      'lib/prova-dell-import-orfano.ts',
    );
    expect(trovati.join(' · ')).toContain('no-unused-vars');
  }, 30000);

  it('ma quello che si dichiara inutile apposta, col trattino basso davanti, si', async () => {
    // Un argomento che non serve ma che la firma impone — succede sui gestori
    // e sulle interfacce — si segna con `_` e resta legittimo.
    const trovati = await errori(
      'export function gestisci(_richiesta: string, usato: number) {\n  return usato;\n}\n',
      'lib/prova-del-trattino-basso.ts',
    );
    expect(
      trovati.join(' · '),
      'un argomento dichiarato inutile apposta viene bocciato: la regola diventa impraticabile e qualcuno la spegne',
    ).not.toContain('no-unused-vars');
  }, 30000);

  it('e il codice buono resta buono', async () => {
    const trovati = await errori(
      'export function somma(a: number, b: number) {\n  return a + b;\n}\n',
      'lib/prova-del-codice-vivo.ts',
    );
    expect(trovati, `il controllo si lamenta di codice sano: ${trovati.join(' · ')}`).toEqual([]);
  }, 30000);
});
