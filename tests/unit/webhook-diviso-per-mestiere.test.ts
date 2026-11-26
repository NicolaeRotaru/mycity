import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #12 — IL GESTORE DEI PAGAMENTI ERA UN FILE SOLO DA MILLE RIGHE CON DENTRO
 * OTTO MESTIERI.
 *
 * Creazione ordini, buoni regalo, spazi sponsorizzati, abbonamenti dei
 * venditori, rimborsi, contestazioni carta, storni di bonifico, esiti dei
 * pagamenti: tutto nello stesso posto. Ogni modifica ai buoni regalo si
 * portava dietro il rischio di toccare la creazione degli ordini, perché la
 * revisione mostrava un diff dentro un blocco da mille righe — sulla strada
 * su cui passano tutti i soldi del marketplace.
 *
 * Questa prova non guarda la bellezza del codice: guarda che il confine
 * regga. Se qualcuno rimette un gestore dentro la rotta, torna rossa.
 */

// La variabile serve solo a riparazione-r09-la-prova-del-webhook-non-si-inganna.test.ts, che fa
// leggere a questa prova una copia guastata della rotta e pretende che diventi rossa.
const ROTTA = process.env.ROTTA_DEL_WEBHOOK_DA_LEGGERE ?? join(process.cwd(), 'app/api/stripe/webhook/route.ts');
const CARTELLA = join(process.cwd(), 'lib/stripe/webhook');

describe('il webhook Stripe è diviso per mestiere', () => {
  it('la rotta fa solo firma, anti-doppione e smistamento', () => {
    const rotta = readFileSync(ROTTA, 'utf8');
    const righe = rotta.split('\n').length;
    expect(righe).toBeLessThan(250);

    // Le tre cose che devono restare.
    expect(rotta).toContain('constructEvent');
    expect(rotta).toContain('stripe_event_log');
    expect(rotta).toContain('switch (event.type)');
  });

  it('nessun gestore è rimasto dentro la rotta', () => {
    const rotta = readFileSync(ROTTA, 'utf8');
    // I gestori si importano, non si definiscono qui.
    const definizioni = rotta.match(/^async function handle/gm) ?? [];
    expect(definizioni.length).toBe(0);
  });

  it('ogni mestiere ha il suo file, e nessuno è di nuovo enorme', () => {
    const file = readdirSync(CARTELLA).filter((f) => f.endsWith('.ts'));
    expect(file.length).toBeGreaterThanOrEqual(8);
    for (const f of file) {
      const righe = readFileSync(join(CARTELLA, f), 'utf8').split('\n').length;
      expect(righe, `${f} è tornato troppo grande`).toBeLessThan(600);
    }
  });

  it('il controllo anti-doppione marca l evento DOPO il gestore, non prima', () => {
    // È la parte fatta bene, ed è quella facile da rompere spostando il
    // codice: se l'evento si marcasse come lavorato prima, un gestore fallito
    // non verrebbe mai riprovato da Stripe e l'ordine sparirebbe.
    const { smistamento, dopo, fuoriPosto } = marcatureDellaRotta(readFileSync(ROTTA, 'utf8'));
    expect(smistamento, 'la rotta non smista più con `switch (event.type)`').toBe(true);
    expect(fuoriPosto, 'evento segnato come lavorato prima dello smistamento o nel ramo dell errore').toEqual([]);
    expect(dopo, 'nessuna marcatura dopo lo smistamento: l evento non si segna più come lavorato').toBeGreaterThan(0);
  });
});

/**
 * 26/11/2026 — LA MARCATURA SI CERCA SULL'ALBERO DEL CODICE, NON COME PAROLA.
 *
 * Prima la prova confrontava `indexOf('switch (event.type)')` con `indexOf("processed: true")`:
 * una marcatura messa prima dello smistamento ma scritta `processed:true`, o andando a capo, non
 * la vedeva, e la prova restava verde. Qui la rotta si legge col compilatore TypeScript: conta
 * ogni proprietà `processed` che non vale `false`, comunque sia scritta (spazi, a capo, virgolette).
 *
 * Il posto giusto è uno di due: dentro lo smistamento (un ramo che chiude l'evento senza gestore,
 * come la sessione completata ma non pagata) o dopo, nello stesso blocco, quando il gestore è
 * riuscito. Prima dello smistamento, o nel ramo dell'errore, un gestore fallito non verrebbe più
 * riprovato da Stripe. Sbaglia solo verso il rosso: una marcatura spostata in un aiutante importato
 * non si vede qui, e allora manca quella «dopo» e la prova boccia.
 */
function marcatureDellaRotta(testo: string): { smistamento: boolean; dopo: number; fuoriPosto: string[] } {
  const sorgente = ts.createSourceFile('route.ts', testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let smistamento: ts.SwitchStatement | undefined;
  const marcature: ts.Node[] = [];
  const visita = (n: ts.Node) => {
    if (
      !smistamento && ts.isSwitchStatement(n) && ts.isPropertyAccessExpression(n.expression)
      && n.expression.name.text === 'type' && n.expression.expression.getText(sorgente) === 'event'
    ) smistamento = n;
    if (
      ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
      && n.name.text === 'processed' && n.initializer.kind !== ts.SyntaxKind.FalseKeyword
    ) marcature.push(n);
    ts.forEachChild(n, visita);
  };
  visita(sorgente);
  const sw = smistamento;
  if (!sw) return { smistamento: false, dopo: 0, fuoriPosto: [] };
  const blocco = sw.parent;
  let dopo = 0;
  const fuoriPosto: string[] = [];
  for (const m of marcature) {
    if (m.getStart(sorgente) >= sw.getStart(sorgente) && m.end <= sw.end) continue; // dentro lo smistamento
    let a: ts.Node = m;
    while (a.parent && a.parent !== blocco) a = a.parent;
    if (a.parent === blocco && ts.isBlock(blocco) && blocco.statements.indexOf(a as ts.Statement) > blocco.statements.indexOf(sw)) {
      dopo++;
      continue;
    }
    fuoriPosto.push(`riga ${sorgente.getLineAndCharacterOfPosition(m.getStart(sorgente)).line + 1}: ${m.getText(sorgente)}`);
  }
  return { smistamento: true, dopo, fuoriPosto };
}
