import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 1/11/2026 — NESSUNA PROVA NEL BROWSER E' UN GUSCIO VUOTO.
 *
 * Il difetto: nel file della cassa (tests/e2e/12-…) tre prove dai nomi
 * rassicuranti — «l'ordine nasce», «il rimborso esiste», «il bonifico parte» —
 * avevano per corpo intero `expect(SENZA_AMBIENTE_DI_PROVA).toBe(false)`.
 * Controllavano l'interruttore, non la cassa: con E2E_DATI_DI_PROVA acceso
 * diventavano verdi in tre millesimi senza aprire niente. Dopo, il corpo era
 * diventato `test.skip(true, …)`: piu' onesto, ma la stessa forma — basta
 * rimettere l'interruttore al posto di `true` e il verde a vuoto torna.
 *
 * La regola, letta con il compilatore di TypeScript e non cercando parole:
 *  ① una prova normale (`test(…)`, `test.only(…)`) deve chiedere almeno una
 *     delle cose con cui si guarda il sito — page, request, context, browser —
 *     e usarla davvero nel suo corpo. Se non tocca niente, non prova niente.
 *  ② una prova che non si puo' ancora scrivere si dichiara saltata alla
 *     nascita (`test.skip(titolo, { annotation: { type: 'skip', description } }, …)`
 *     o `test.fixme`), con il motivo scritto: cosi' il riepilogo della CI lo
 *     legge, e nessun interruttore la puo' far diventare verde.
 */

const CARTELLA = join(process.cwd(), 'tests/e2e');
const STRUMENTI = new Set(['page', 'request', 'context', 'browser']);

type Difetto = { file: string; riga: number; titolo: string; perche: string };

function titoloDi(n: ts.Expression | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

/** `test`, `test.only`, `test.skip`, `test.fixme` → il nome del modo. */
function modoDellaChiamata(c: ts.CallExpression): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e) && e.text === 'test') return 'test';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'test') {
    return e.name.text;
  }
  return null;
}

/** I nomi degli strumenti chiesti dalla funzione della prova: `async ({ page, request }) => …`. */
function strumentiChiesti(f: ts.ArrowFunction | ts.FunctionExpression): string[] {
  const primo = f.parameters[0];
  if (!primo || !ts.isObjectBindingPattern(primo.name)) return [];
  return primo.name.elements
    .map((el) => (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : ''))
    .filter((n) => STRUMENTI.has(n));
}

function nomiLocali(f: ts.ArrowFunction | ts.FunctionExpression): Set<string> {
  const primo = f.parameters[0];
  const fuori = new Set<string>();
  if (!primo || !ts.isObjectBindingPattern(primo.name)) return fuori;
  for (const el of primo.name.elements) {
    const chiave = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '';
    if (STRUMENTI.has(chiave) && ts.isIdentifier(el.name)) fuori.add(el.name.text);
  }
  return fuori;
}

function usaUnoDi(corpo: ts.Node, nomi: Set<string>): boolean {
  let trovato = false;
  const visita = (n: ts.Node) => {
    if (trovato) return;
    if (ts.isIdentifier(n) && nomi.has(n.text)) {
      trovato = true;
      return;
    }
    ts.forEachChild(n, visita);
  };
  ts.forEachChild(corpo, visita);
  return trovato;
}

function motivoDichiarato(arg: ts.Expression | undefined, fonte: ts.SourceFile): boolean {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  const ann = arg.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(fonte) === 'annotation',
  );
  if (!ann) return false;
  const lista = ts.isArrayLiteralExpression(ann.initializer) ? ann.initializer.elements : [ann.initializer];
  return lista.some((a) => {
    if (!ts.isObjectLiteralExpression(a)) return false;
    const tipo = a.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(fonte) === 'type');
    const desc = a.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(fonte) === 'description');
    // Il motivo puo' essere composto (costante + testo): basta che non sia una stringa vuota.
    const descVuota = !desc || ((ts.isStringLiteral(desc.initializer) || ts.isNoSubstitutionTemplateLiteral(desc.initializer)) && desc.initializer.text.trim() === '');
    return !!tipo && titoloDi(tipo.initializer) === 'skip' && !descVuota;
  });
}

function gusciVuoti(file: string, testo: string): Difetto[] {
  const fonte = ts.createSourceFile(file, testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const difetti: Difetto[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const modo = modoDellaChiamata(n);
      const titolo = titoloDi(n.arguments[0]);
      const funzione = n.arguments[n.arguments.length - 1];
      // Solo le DICHIARAZIONI di prova: titolo scritto + funzione in fondo.
      // `test.skip(condizione, motivo)` dentro un corpo non ha ne' l'uno ne' l'altra.
      if (modo && titolo !== null && funzione && (ts.isArrowFunction(funzione) || ts.isFunctionExpression(funzione))) {
        const riga = fonte.getLineAndCharacterOfPosition(n.getStart(fonte)).line + 1;
        if (modo === 'test' || modo === 'only') {
          const chiesti = strumentiChiesti(funzione);
          if (chiesti.length === 0) {
            difetti.push({ file, riga, titolo, perche: 'non chiede ne\' page ne\' request: non puo\' guardare niente' });
          } else if (!usaUnoDi(funzione.body, nomiLocali(funzione))) {
            difetti.push({ file, riga, titolo, perche: `chiede ${chiesti.join(', ')} ma non li usa mai` });
          }
        } else if (modo === 'skip' || modo === 'fixme') {
          if (!motivoDichiarato(n.arguments.length >= 3 ? n.arguments[1] : undefined, fonte)) {
            difetti.push({ file, riga, titolo, perche: 'saltata alla nascita senza un motivo scritto (annotation type skip)' });
          }
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte);
  return difetti;
}

describe('la regola sa riconoscere un guscio', () => {
  const casi: { nome: string; testo: string; rossa: boolean }[] = [
    {
      nome: 'il corpo di prima: un expect sull\'interruttore',
      testo: `test('ordine', async () => { expect(SENZA_AMBIENTE_DI_PROVA).toBe(false); });`,
      rossa: true,
    },
    {
      nome: 'la variabile d\'ambiente letta dritta',
      testo: `test('ordine', async () => { expect(!process.env.E2E_DATI_DI_PROVA).toBe(false); });`,
      rossa: true,
    },
    {
      nome: 'il salto dentro un corpo che non guarda niente',
      testo: `test('ordine', async () => { test.skip(true, 'non scritta'); });`,
      rossa: true,
    },
    {
      nome: 'chiede la pagina ma non la usa',
      testo: `test('ordine', async ({ page }) => { expect(1).toBe(1); });`,
      rossa: true,
    },
    {
      nome: 'saltata alla nascita senza motivo',
      testo: `test.skip('ordine', async () => {});`,
      rossa: true,
    },
    {
      nome: 'una prova vera che chiama il server',
      testo: `test('ordine', async ({ request }) => { const r = await request.post('/x'); expect(r.status()).toBe(401); });`,
      rossa: false,
    },
    {
      nome: 'una prova vera con lo strumento rinominato',
      testo: `test('ordine', async ({ page: p }) => { await p.goto('/'); });`,
      rossa: false,
    },
    {
      nome: 'saltata alla nascita col motivo scritto',
      testo: `test.skip('ordine', { annotation: { type: 'skip', description: NON_SCRITTA + 'manca Stripe' } }, async () => {});`,
      rossa: false,
    },
    {
      nome: 'un salto con condizione dentro una prova vera non e\' una dichiarazione',
      testo: `test('ordine', async ({ page }) => { test.skip(!process.env.X, 'manca X'); await page.goto('/'); });`,
      rossa: false,
    },
  ];
  for (const c of casi) {
    it(c.nome, () => {
      expect(gusciVuoti('caso.ts', c.testo).length > 0).toBe(c.rossa);
    });
  }
});

describe('nessuna prova nel browser e\' un guscio vuoto', () => {
  const file = readdirSync(CARTELLA).filter((f) => f.endsWith('.spec.ts'));

  it('la cartella delle prove nel browser c\'e\' e ha dentro il file della cassa', () => {
    expect(file).toContain('12-la-cassa-dal-carrello-al-pagamento.spec.ts');
  });

  it('ogni prova normale guarda la pagina o il server, ogni prova saltata dice perche\'', () => {
    const difetti = file.flatMap((f) => gusciVuoti(f, readFileSync(join(CARTELLA, f), 'utf8')));
    expect(
      difetti.map((d) => `${d.file}:${d.riga} «${d.titolo}» — ${d.perche}`),
      'una prova che non tocca page ne\' request diventa verde senza aver guardato niente',
    ).toEqual([]);
  });

  it('le tre prove dell\'acquisto vero esistono ancora, dichiarate e non sparite', () => {
    const testo = readFileSync(join(CARTELLA, '12-la-cassa-dal-carrello-al-pagamento.spec.ts'), 'utf8');
    const fonte = ts.createSourceFile('12.ts', testo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const titoli: string[] = [];
    const visita = (n: ts.Node) => {
      if (ts.isCallExpression(n) && modoDellaChiamata(n)) {
        const t = titoloDi(n.arguments[0]);
        if (t) titoli.push(t);
      }
      ts.forEachChild(n, visita);
    };
    visita(fonte);
    for (const t of [
      'contrassegno: l\'ordine nasce e il negozio lo vede',
      'rifiuto del negozio su un ordine pagato: il rimborso esiste',
      'consegna completata: il bonifico al negozio parte',
    ]) {
      expect(titoli, `«${t}» e' sparita: cancellarla non la rende provata`).toContain(t);
    }
  });
});
