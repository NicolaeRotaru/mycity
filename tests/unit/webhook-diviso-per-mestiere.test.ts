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

const ROTTA = join(process.cwd(), 'app/api/stripe/webhook/route.ts');
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
 * 26/11/2026 sera (R26-003) — E COMUNQUE SIA SCRITTA DAVVERO. Contava solo `processed: <valore>`:
 * la forma breve (`const processed = true; update({ processed })`), la chiave calcolata
 * (`['processed']: true`) e l'assegnazione (`riga.processed = true`) passavano. E saltava tutto lo
 * smistamento: una marcatura dentro un `case`, prima del suo gestore, restava verde. Adesso conta
 * anche quelle, e dentro lo smistamento la marcatura vale solo se subito dopo l'evento esce (un
 * `return` o un `break`): è il ramo che chiude l'evento senza gestore, come la sessione completata
 * ma non pagata. La prova che questa lettura diventa rossa sulle copie guastate della rotta è
 * `riparazione-r09-la-prova-del-webhook-non-si-inganna.test.ts` (senza vitest figli): per questo la
 * funzione resta qui, tutta dentro di sé.
 *
 * Il posto giusto, fuori dallo smistamento, è dopo, nello stesso blocco, quando il gestore è
 * riuscito. Prima dello smistamento, nel ramo dell'errore o nel `finally`, un gestore fallito non
 * verrebbe più riprovato da Stripe. Quello che non vede: una marcatura fatta da un aiutante
 * importato (una chiamata, non un oggetto con `processed`). Spostata lì manca quella «dopo» e la
 * prova boccia; ma aggiunta lì prima dello smistamento, lasciando quella di dopo, non la vede: per
 * quel caso valgono le prove che eseguono il webhook (stripe-webhook-idempotenza,
 * se-il-database-sbaglia-stripe-riprova).
 */
function marcatureDellaRotta(testo: string): { smistamento: boolean; dopo: number; fuoriPosto: string[] } {
  const sorgente = ts.createSourceFile('route.ts', testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** Il nome di una chiave scritta come parola, tra virgolette o calcolata con un testo fisso. */
  const nomeDellaChiave = (n: ts.PropertyName): string | null => {
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isComputedPropertyName(n)) {
      const e = n.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    }
    return null;
  };
  let smistamento: ts.SwitchStatement | undefined;
  const marcature: ts.Node[] = [];
  const visita = (n: ts.Node) => {
    if (
      !smistamento && ts.isSwitchStatement(n) && ts.isPropertyAccessExpression(n.expression)
      && n.expression.name.text === 'type' && n.expression.expression.getText(sorgente) === 'event'
    ) smistamento = n;
    // `processed: true`, `'processed': true`, `['processed']: true` — tutto tranne `false`.
    if (ts.isPropertyAssignment(n) && nomeDellaChiave(n.name) === 'processed' && n.initializer.kind !== ts.SyntaxKind.FalseKeyword) marcature.push(n);
    // `{ processed }`: il valore sta altrove, quindi conta sempre.
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'processed') marcature.push(n);
    // `riga.processed = true` o `riga['processed'] = true`.
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.right.kind !== ts.SyntaxKind.FalseKeyword) {
      const l = n.left;
      const nome = ts.isPropertyAccessExpression(l) ? l.name.text
        : ts.isElementAccessExpression(l) && (ts.isStringLiteral(l.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(l.argumentExpression)) ? l.argumentExpression.text
          : null;
      if (nome === 'processed') marcature.push(n);
    }
    ts.forEachChild(n, visita);
  };
  visita(sorgente);
  const sw = smistamento;
  if (!sw) return { smistamento: false, dopo: 0, fuoriPosto: [] };
  const riga = (m: ts.Node) => `riga ${sorgente.getLineAndCharacterOfPosition(m.getStart(sorgente)).line + 1}: ${m.getText(sorgente)}`;
  /** L'istruzione che contiene `m` dentro un elenco di istruzioni (un blocco o un `case`), con l'elenco. */
  const istruzioneDi = (m: ts.Node): { istruzione: ts.Statement; elenco: ts.NodeArray<ts.Statement> } | null => {
    let a: ts.Node = m;
    while (a.parent) {
      const p = a.parent;
      if ((ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isSourceFile(p)) && p.statements.includes(a as ts.Statement)) {
        return { istruzione: a as ts.Statement, elenco: p.statements };
      }
      a = p;
    }
    return null;
  };
  const blocco = sw.parent;
  let dopo = 0;
  const fuoriPosto: string[] = [];
  for (const m of marcature) {
    if (m.getStart(sorgente) >= sw.getStart(sorgente) && m.end <= sw.end) {
      // Dentro lo smistamento: solo se subito dopo l'evento esce, senza lavorare altro.
      const qui = istruzioneDi(m);
      const seguente = qui ? qui.elenco[qui.elenco.indexOf(qui.istruzione) + 1] : undefined;
      if (seguente && (ts.isReturnStatement(seguente) || ts.isBreakStatement(seguente))) continue;
      fuoriPosto.push(`${riga(m)} (dentro lo smistamento, prima di altro lavoro)`);
      continue;
    }
    let a: ts.Node = m;
    while (a.parent && a.parent !== blocco) a = a.parent;
    if (a.parent === blocco && ts.isBlock(blocco) && blocco.statements.indexOf(a as ts.Statement) > blocco.statements.indexOf(sw)) {
      dopo++;
      continue;
    }
    fuoriPosto.push(riga(m));
  }
  return { smistamento: true, dopo, fuoriPosto };
}
