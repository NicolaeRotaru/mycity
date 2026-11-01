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
/** I modi di `test.<modo>(…)` che dichiarano una prova. Gli altri (describe, beforeEach, step…) no. */
const MODI_DICHIARAZIONE = new Set(['only', 'skip', 'fixme', 'fail']);

/*
 * 1/11/2026 — Il collaudo l'ha aggirata in quattro modi: titolo con
 * sostituzione (`x ${y}`), titolo da variabile, `const prova = test`, corpo
 * passato per nome. Ora:
 *  - e' una dichiarazione OGNI chiamata a `test`, `test.only/skip/fixme/fail`
 *    o a un loro alias locale (`const prova = test`, `test.extend(…)`) il cui
 *    ultimo argomento e' una funzione — scritta li' o nominata e risolta verso
 *    la sua definizione nel file. Il titolo non conta.
 *  - una prova guarda se usa uno strumento destrutturato (`{ page }`,
 *    `{ page: p }`) oppure, col parametro intero, `fx.page` / `fx.request` /
 *    `fx.context` / `fx.browser`.
 *
 * LIMITE DICHIARATO: la regola guarda la forma, non il significato. `void page`
 * o `page;` contano come uso, e un corpo che importa la funzione da un altro
 * file non si risolve (resta rosso: meglio un rosso da spiegare che un verde
 * finto). Non ferma chi vuole imbrogliare apposta: ferma il guscio per
 * distrazione, che e' il modo in cui e' nato il difetto.
 */

type Difetto = { file: string; riga: number; titolo: string; perche: string };
type Funzione = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

function titoloDi(n: ts.Expression | undefined, fonte?: ts.SourceFile): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return fonte ? n.getText(fonte) : null;
}

function eFunzione(n: ts.Node | undefined): n is Funzione {
  return !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n));
}

/** Il file letto una volta: alias di `test` e funzioni con nome. */
function mappa(fonte: ts.SourceFile) {
  const alias = new Set(['test']);
  const funzioni = new Map<string, Funzione>();
  const dichiarati = new Set<string>();
  const iniziali: [string, ts.Expression][] = [];
  const visita = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) funzioni.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) dichiarati.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      iniziali.push([n.name.text, n.initializer]);
      if (eFunzione(n.initializer)) funzioni.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte);
  const radice = (e: ts.Expression): string | null => {
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x)) x = x.expression;
    if (ts.isIdentifier(x)) return x.text;
    if (ts.isPropertyAccessExpression(x)) return radice(x.expression);
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'extend') {
      return radice(x.expression.expression);
    }
    return null;
  };
  // Punto fisso: `const a = test; const b = a.only;` → anche b e' un alias.
  for (let cambiato = true; cambiato; ) {
    cambiato = false;
    for (const [nome, ini] of iniziali) {
      const r = radice(ini);
      if (r && alias.has(r) && !alias.has(nome)) {
        alias.add(nome);
        cambiato = true;
      }
    }
  }
  return { alias, funzioni, dichiarati };
}

function eDichiarazione(c: ts.CallExpression, alias: Set<string>): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e) && alias.has(e.text)) return 'test';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && alias.has(e.expression.text)) {
    return MODI_DICHIARAZIONE.has(e.name.text) ? e.name.text : null;
  }
  return null;
}

/**
 * La funzione del corpo. Un nome dichiarato nel file ma non come funzione (il
 * motivo di `test.skip(cond, PERCHE)`) non e' un corpo; un nome che non e'
 * dichiarato nel file (importato) e' «sconosciuto».
 */
function risolvi(
  arg: ts.Expression | undefined,
  m: { funzioni: Map<string, Funzione>; dichiarati: Set<string> },
): Funzione | 'sconosciuta' | null {
  if (!arg) return null;
  if (eFunzione(arg)) return arg;
  if (ts.isIdentifier(arg)) {
    const f = m.funzioni.get(arg.text);
    if (f) return f;
    return m.dichiarati.has(arg.text) ? null : 'sconosciuta';
  }
  return null;
}

function usa(corpo: ts.Node | undefined, vale: (n: ts.Node) => boolean): boolean {
  if (!corpo) return false;
  let trovato = false;
  const visita = (n: ts.Node) => {
    if (trovato) return;
    if (vale(n)) {
      trovato = true;
      return;
    }
    ts.forEachChild(n, visita);
  };
  ts.forEachChild(corpo, visita);
  return trovato;
}

/** Vero se la funzione chiede uno strumento per guardare il sito e lo usa. */
function guarda(f: Funzione): boolean {
  const primo = f.parameters[0];
  if (!primo) return false;
  if (ts.isIdentifier(primo.name)) {
    const nome = primo.name.text;
    return usa(
      f.body,
      (n) => ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nome && STRUMENTI.has(n.name.text),
    );
  }
  if (!ts.isObjectBindingPattern(primo.name)) return false;
  const locali = new Set<string>();
  const resti = new Set<string>();
  for (const el of primo.name.elements) {
    if (el.dotDotDotToken && ts.isIdentifier(el.name)) {
      resti.add(el.name.text);
      continue;
    }
    const chiave = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '';
    if (STRUMENTI.has(chiave) && ts.isIdentifier(el.name)) locali.add(el.name.text);
  }
  return usa(
    f.body,
    (n) =>
      (ts.isIdentifier(n) && locali.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) ||
      (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && resti.has(n.expression.text) && STRUMENTI.has(n.name.text)),
  );
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
  const m = mappa(fonte);
  const { alias } = m;
  const difetti: Difetto[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length >= 2) {
      const modo = eDichiarazione(n, alias);
      const ultimo = n.arguments[n.arguments.length - 1];
      let funzione = modo ? risolvi(ultimo, m) : null;
      // Su skip/fixme un nome importato e' quasi sempre il motivo, non il corpo.
      if (funzione === 'sconosciuta' && modo !== 'test' && modo !== 'only' && modo !== 'fail') funzione = null;
      // `test.skip(condizione, motivo)` dentro un corpo non finisce con una funzione: non e' una dichiarazione.
      if (modo && funzione) {
        const riga = fonte.getLineAndCharacterOfPosition(n.getStart(fonte)).line + 1;
        const titolo = titoloDi(n.arguments[0], fonte) ?? '?';
        if (modo === 'test' || modo === 'only' || modo === 'fail') {
          if (funzione === 'sconosciuta') {
            difetti.push({ file, riga, titolo, perche: `il corpo «${ultimo.getText(fonte)}» non e' definito in questo file: non si puo' vedere cosa guarda` });
          } else if (!guarda(funzione)) {
            difetti.push({ file, riga, titolo, perche: 'non usa ne\' page ne\' request ne\' context ne\' browser: non puo\' guardare niente' });
          }
        } else if (!motivoDichiarato(n.arguments.length >= 3 ? n.arguments[1] : undefined, fonte)) {
          difetti.push({ file, riga, titolo, perche: 'saltata alla nascita senza un motivo scritto (annotation type skip)' });
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(fonte);
  return difetti;
}

/** Per l'ultima prova: i titoli scritti delle dichiarazioni del file. */
function modoDellaChiamata(c: ts.CallExpression): string | null {
  return eDichiarazione(c, new Set(['test']));
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
    // 1/11/2026 — le quattro scappatoie trovate dal collaudo.
    {
      nome: 'titolo con sostituzione',
      testo: 'test(`ordine ${y}`, async () => { expect(FLAG).toBe(false); });',
      rossa: true,
    },
    {
      nome: 'titolo da variabile',
      testo: `const t = 'ordine'; test(t, async () => { expect(FLAG).toBe(false); });`,
      rossa: true,
    },
    {
      nome: 'test con un altro nome',
      testo: `const prova = test; prova('ordine', async () => { expect(FLAG).toBe(false); });`,
      rossa: true,
    },
    {
      nome: 'alias di un alias e test.extend',
      testo: `const a = test.extend({}); const b = a; b.only('ordine', async () => { expect(FLAG).toBe(false); });`,
      rossa: true,
    },
    {
      nome: 'corpo passato per nome',
      testo: `const corpo = async () => { expect(FLAG).toBe(false); }; test('ordine', corpo);`,
      rossa: true,
    },
    {
      nome: 'corpo come funzione dichiarata',
      testo: `async function corpo() { expect(FLAG).toBe(false); } test('ordine', corpo);`,
      rossa: true,
    },
    {
      nome: 'corpo che viene da un altro file',
      testo: `import { corpo } from './x'; test('ordine', corpo);`,
      rossa: true,
    },
    {
      nome: 'il nome dello strumento solo come proprieta\' di altro',
      testo: `test('ordine', async ({ page }) => { expect(cose.page).toBe(1); });`,
      rossa: true,
    },
    {
      nome: 'parametro intero che non usa nessuno strumento',
      testo: `test('ordine', async (fx) => { expect(fx.baseURL).toBe('x'); });`,
      rossa: true,
    },
    {
      nome: 'titolo con sostituzione su una prova vera',
      testo: 'test(`${path} si apre`, async ({ page }) => { await page.goto(path); });',
      rossa: false,
    },
    {
      nome: 'parametro intero che usa la pagina',
      testo: `test('ordine', async (fx) => { await fx.page.goto('/'); });`,
      rossa: false,
    },
    {
      nome: 'fixture personalizzata accanto alla pagina',
      testo: `test('ordine', async ({ baseURL, page }) => { await page.goto(baseURL + '/'); });`,
      rossa: false,
    },
    {
      nome: 'il resto della destrutturazione che usa la richiesta',
      testo: `test('ordine', async ({ baseURL, ...fx }) => { await fx.request.get(baseURL!); });`,
      rossa: false,
    },
    {
      nome: 'corpo per nome che guarda davvero',
      testo: `async function corpo({ page }) { await page.goto('/'); } const prova = test; prova('ordine', corpo);`,
      rossa: false,
    },
    {
      nome: 'describe, beforeEach e le regex .test() non sono prove',
      testo: `test.describe('g', () => {}); test.beforeEach(async () => {}); /x/.test('x');`,
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
