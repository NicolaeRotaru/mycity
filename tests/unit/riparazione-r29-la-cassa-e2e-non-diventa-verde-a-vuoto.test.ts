import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * R29-001 — LE TRE PROVE DELL'ACQUISTO VERO NON DIVENTANO VERDI A VUOTO.
 *
 * In tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts le tre prove dell'acquisto vero
 * (contrassegno, rimborso, bonifico) erano gusci `async () => {}` dichiarati saltati: passavano in
 * tre millesimi senza aprire niente, e nessun lavoro della CI le faceva girare. Questa guardia
 * pretende che un ordine nasca davvero, non il salto:
 *
 *  ① LO SPEC. Ogni prova è una prova normale (non saltata alla nascita), entra da una rotta vera
 *    della cassa e legge l'ordine nel database di prova; per la carta passa dall'avviso firmato
 *    di Stripe, e il rimborso e il trasferimento li rilegge su Stripe. Nessuna asserzione guarda
 *    la variabile E2E_DATI_DI_PROVA: la variabile decide solo se girare.
 *  ② LA CI. C'è un lavoro che le fa girare (e2e-cassa-vera) contro un Supabase LOCALE, con
 *    E2E_DATI_DI_PROVA accesa solo lì; si salta da solo finché la variabile del repository non
 *    vale 1, e non diventa mai rosso perché manca un segreto: il controllo delle chiavi esce
 *    sempre a zero, e la chiave Stripe che arriva al sito è solo quella di prova.
 *
 * La prova che le tre prove cadono davvero senza ambiente (e non passano) sta in
 * tests/unit/le-prove-della-cassa-non-passano-senza-aver-guardato.test.ts, che le fa girare.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

const SPEC = join(process.cwd(), 'tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts');
const CI = join(process.cwd(), '.github/workflows/ci.yml');
const LAVORO = 'e2e-cassa-vera';

// ─── ① lo spec ──────────────────────────────────────────────────────────────────────────────

type Dichiarazione = { modo: string; corpo: ts.Node | undefined; parametri: string };

function fonte(): ts.SourceFile {
  return ts.createSourceFile('12.ts', readFileSync(SPEC, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Una chiamata a `test` → 'test'; a un suo metodo (il salto, il fixme…) → il nome del metodo; altrimenti null. */
function modoDi(c: ts.CallExpression): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e) && e.text === 'test') return 'test';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'test') return e.name.text;
  return null;
}

function dichiarazioni(titolo: string): Dichiarazione[] {
  const f = fonte();
  const out: Dichiarazione[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length >= 2) {
      const modo = modoDi(n);
      const primo = n.arguments[0];
      if (modo && (ts.isStringLiteral(primo) || ts.isNoSubstitutionTemplateLiteral(primo)) && primo.text === titolo) {
        const ultimo = n.arguments[n.arguments.length - 1];
        const funzione = ts.isArrowFunction(ultimo) || ts.isFunctionExpression(ultimo) ? ultimo : undefined;
        out.push({
          modo,
          corpo: funzione?.body,
          parametri: funzione ? funzione.parameters.map((p) => p.getText(f)).join(',') : '',
        });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(f);
  return out;
}

/**
 * Il testo di un nodo dello spec senza i commenti: un commento che elenca le parole giuste non fa
 * nascere nessun ordine. Si tolgono gli intervalli che TypeScript riconosce come commenti davanti a
 * ogni pezzo del codice (non le stringhe né le espressioni regolari che contengono `//`).
 */
function senzaCommenti(n: ts.Node): string {
  const testo = n.getSourceFile().getFullText();
  const tagli: Array<[number, number]> = [];
  const visita = (x: ts.Node) => {
    if (ts.isJSDoc(x)) return;
    const figli = x.getChildren();
    if (figli.length > 0) {
      figli.forEach(visita);
      return;
    }
    const p = x.getFullStart();
    for (const r of [...(ts.getLeadingCommentRanges(testo, p) ?? []), ...(ts.getTrailingCommentRanges(testo, p) ?? [])]) {
      tagli.push([r.pos, r.end]);
    }
  };
  visita(n);
  let fuori = '';
  let da = n.getStart();
  for (const [inizio, fine] of tagli.sort((a, b) => a[0] - b[0])) {
    if (fine <= da) continue;
    fuori += testo.slice(da, Math.max(da, inizio));
    da = fine;
  }
  return fuori + testo.slice(da, n.getEnd());
}

/** Il testo di una funzione dello spec dichiarata per nome (`function x() {}` o `const x = () => {}`). */
function funzione(nome: string): string {
  const f = fonte();
  let testo = '';
  const visita = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === nome) testo = n.getText(f);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nome && n.initializer) testo = n.initializer.getText(f);
    ts.forEachChild(n, visita);
  };
  visita(f);
  return testo;
}

/** Le chiamate che spengono una prova dentro un corpo: `test.<metodo>` col nome del salto o del fixme. */
function saltiDentro(corpo: ts.Node | undefined): string[] {
  const out: string[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ['skip', 'fixme', 'fail'].includes(modoDi(n) ?? '')) out.push(n.getText());
    ts.forEachChild(n, visita);
  };
  if (corpo) visita(corpo);
  return out;
}

const PROVE: Array<{ titolo: string; deve: RegExp[] }> = [
  {
    titolo: 'contrassegno: l\'ordine nasce e il negozio lo vede',
    deve: [/preparaLaBottega\(/, /request\.post\(\s*'\/api\/orders\/cod'/, /leggiOrdine\(/, /toBe\('NEW'\)/, /total_price/, /from\('notifications'\)/],
  },
  {
    titolo: 'rifiuto del negozio su un ordine pagato: il rimborso esiste',
    deve: [/ordinePagatoConLaCarta\(/, /\/reject/, /leggiOrdine\(/, /stripe_refund_id/, /toBe\('REFUNDED'\)/, /refunds\.retrieve\(/],
  },
  {
    titolo: 'consegna completata: il bonifico al negozio parte',
    deve: [/ordinePagatoConLaCarta\(/, /\/api\/cron\/release-payouts/, /leggiOrdine\(/, /toBe\('TRANSFERRED'\)/, /transfers\.retrieve\(/],
  },
];

describe('R29-001 · ① le tre prove dell acquisto vero hanno un corpo che fa nascere l ordine', () => {
  for (const p of PROVE) {
    it(`«${p.titolo}» è una prova vera, che entra da una rotta e legge l ordine`, () => {
      const trovate = dichiarazioni(p.titolo);
      expect(trovate, `«${p.titolo}» non c'è più nello spec: cancellarla non la rende provata`).toHaveLength(1);
      const d = trovate[0];
      expect(d.modo, `«${p.titolo}» è dichiarata «test.${d.modo}»: un guscio saltato alla nascita non fa nascere nessun ordine`).toBe('test');
      expect(d.parametri, `«${p.titolo}» non chiede né request né page: non può guardare niente`).toMatch(/\brequest\b|\bpage\b/);
      const corpo = d.corpo ? senzaCommenti(d.corpo) : '';
      expect(corpo.replace(/\s/g, ''), `«${p.titolo}» ha il corpo vuoto`).not.toMatch(/^\{\}$|^$/);
      const mancano = p.deve.filter((r) => !r.test(corpo)).map(String);
      expect(mancano, `«${p.titolo}» non fa quello che il titolo promette`).toEqual([]);
      expect(saltiDentro(d.corpo), `«${p.titolo}» si spegne da sola: l ambiente lo guarda il salto unico, una volta per tutte`).toEqual([]);
    });
  }

  it('lo spec ha un salto solo per la cassa col database, e il suo motivo dice cosa manca', () => {
    const f = fonte();
    const salti: string[] = [];
    const visita = (n: ts.Node) => {
      if (ts.isCallExpression(n) && modoDi(n) === 'skip') salti.push(n.arguments.map((a) => a.getText(f)).join(', '));
      ts.forEachChild(n, visita);
    };
    visita(f);
    // Le condizioni dei salti: la prima è delle pagine senza JavaScript, che c'era già; la seconda
    // (onda 2, R11-004) è della sola «la cassa disegna il modulo», a cui basta il database; la terza
    // è il salto unico delle tre prove dei soldi. Un salto in più, dentro una delle tre prove o
    // altrove, fa rosso qui.
    expect(salti, 'i salti dello spec sono cambiati: le tre prove non si spengono una per una').toEqual([
      'diagnosi.senzaJavascript, diagnosi.motivo',
      'SENZA_DATABASE_DI_PROVA, PERCHE_SENZA_DATABASE',
      'SENZA_AMBIENTE_DI_PROVA, PERCHE',
    ]);
    // R11-004 — Il salto della cassa disegnata guarda il database locale (e l'interruttore), e vale
    // solo per lei: le tre prove dei soldi passano dal salto unico.
    expect(funzione('COSA_MANCA_AL_DATABASE')).toMatch(/cosaManca\(\s*\[\s*'database'\s*\]\s*\)/);
    expect(funzione('SENZA_DATABASE_DI_PROVA')).toMatch(/!ACCESO\s*\|\|\s*COSA_MANCA_AL_DATABASE\s*!==\s*null/);
    expect(funzione('LA_CASSA_DISEGNATA')).toBe("'la cassa disegna il modulo con la merce riletta dal database'");
    // Il salto unico guarda tutto l'ambiente (database locale, carta, bonifico), non solo l'interruttore.
    expect(funzione('COSA_MANCA'), 'il salto unico non guarda l ambiente intero').toMatch(/cosaManca\(\s*\[\s*'database',\s*'carta',\s*'bonifico'\s*\]\s*\)/);
    expect(funzione('SENZA_AMBIENTE_DI_PROVA')).toMatch(/COSA_MANCA\s*!==\s*null/);
    expect(funzione('PERCHE'), 'il motivo del salto non dice cosa manca').toMatch(/\$\{COSA_MANCA\}/);
  });

  it('l ordine si legge davvero dal database di prova, e il pagamento con la carta passa dall avviso firmato', () => {
    expect(funzione('leggiOrdine'), 'leggiOrdine non legge la tabella degli ordini').toMatch(/from\('orders'\)/);
    expect(funzione('preparaLaBottega'), 'la bottega di prova non semina il prodotto').toMatch(/from\('products'\)/);
    const carta = funzione('ordinePagatoConLaCarta');
    for (const r of [/'\/api\/stripe\/checkout'/, /paymentIntents\.create\(/, /generateTestHeaderString\(/, /'\/api\/stripe\/webhook'/, /toBe\('PAID'\)/]) {
      expect(carta, `il pagamento con la carta non fa ${r}`).toMatch(r);
    }
  });

  it('nessuna asserzione guarda la variabile: la variabile decide solo se girare', () => {
    const f = fonte();
    const colpevoli: string[] = [];
    const visita = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'expect' && n.arguments[0]) {
        const a = n.arguments[0].getText(f);
        // AMBIENTE è la copia di process.env fatta dallo spec: guardarla è guardare la variabile.
        if (/E2E_DATI_DI_PROVA|SENZA_AMBIENTE_DI_PROVA|process\.env|\bAMBIENTE\b/.test(a)) colpevoli.push(a);
      }
      ts.forEachChild(n, visita);
    };
    visita(f);
    expect(colpevoli, 'un expect sull interruttore torna verde senza aver guardato la cassa').toEqual([]);
  });

  it('le prove si seminano solo un database locale: un indirizzo vero non si tocca', () => {
    expect(funzione('cosaManca')).toMatch(/eUnDatabaseLocale\(/);
    expect(funzione('eUnDatabaseLocale')).toMatch(/127\.0\.0\.1/);
  });
});

// ─── ② la CI ────────────────────────────────────────────────────────────────────────────────

type Passo = { name?: string; id?: string; if?: unknown; run?: string; env?: Record<string, unknown> };
type Lavoro = { name?: string; if?: unknown; env?: Record<string, unknown>; steps?: Passo[]; needs?: string | string[] };
type Flusso = { env?: Record<string, unknown>; jobs?: Record<string, Lavoro> };

function flusso(): Flusso {
  return yaml.load(readFileSync(CI, 'utf8')) as Flusso;
}

function ilLavoro(): Lavoro {
  const lavoro = flusso().jobs?.[LAVORO];
  expect(lavoro, `manca il lavoro ${LAVORO}: nessuna CI fa girare le tre prove dell'acquisto vero`).toBeTruthy();
  return lavoro as Lavoro;
}

function passoDelleProve(l: Lavoro): Passo {
  const passo = (l.steps ?? []).find((p) => typeof p.run === 'string' && /playwright test/.test(p.run) && p.run.includes('tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts'));
  expect(passo, `il lavoro ${LAVORO} non fa girare lo spec della cassa`).toBeTruthy();
  return passo as Passo;
}

/** Ogni blocco `env:` del file: del workflow, di ogni lavoro, di ogni passo. */
function tuttiGliEnv(f: Flusso): Array<{ lavoro: string | null; env: Record<string, unknown> }> {
  const out: Array<{ lavoro: string | null; env: Record<string, unknown> }> = [];
  if (f.env) out.push({ lavoro: null, env: f.env });
  for (const [nome, l] of Object.entries(f.jobs ?? {})) {
    if (l.env) out.push({ lavoro: nome, env: l.env });
    for (const p of l.steps ?? []) if (p.env) out.push({ lavoro: nome, env: p.env });
  }
  return out;
}

describe('R29-001 · ② la CI fa girare la cassa vera, e si salta da sola senza le chiavi di prova', () => {
  it('il lavoro accende E2E_DATI_DI_PROVA solo per lo spec della cassa, dopo aver avviato il Supabase locale', () => {
    const l = ilLavoro();
    const passo = passoDelleProve(l);
    expect(String(passo.env?.E2E_DATI_DI_PROVA ?? '')).toBe('1');
    const nomi = (l.steps ?? []).map((p) => p.run ?? '');
    const avvio = nomi.findIndex((r) => r.includes('tests/supabase-locale/avvia.sh'));
    expect(avvio, 'il database di prova non è il Supabase locale').toBeGreaterThanOrEqual(0);
    expect(avvio, 'il Supabase locale parte dopo le prove').toBeLessThan((l.steps ?? []).indexOf(passo));
    // Fuori da questo lavoro nessuno la accende: le altre prove nel browser la leggono a modo loro.
    const altrove = tuttiGliEnv(flusso())
      .filter((b) => b.lavoro !== LAVORO && Object.prototype.hasOwnProperty.call(b.env, 'E2E_DATI_DI_PROVA'))
      .map((b) => b.lavoro ?? 'workflow');
    expect(altrove).toEqual([]);
  });

  it('si salta da solo: il lavoro parte solo con la variabile del repository, mai appeso a un segreto', () => {
    const l = ilLavoro();
    const se = String(l.if ?? '');
    expect(se, 'senza condizione il lavoro parte anche dove l ambiente di prova non c è').toMatch(/vars\.E2E_DATI_DI_PROVA/);
    expect(se, 'a livello di lavoro GitHub non mostra i segreti: la condizione sarebbe sempre falsa').not.toMatch(/secrets\./);
  });

  it('una chiave che manca non lo fa mai rosso: il controllo delle chiavi esce sempre a zero e lo dice', () => {
    const l = ilLavoro();
    const controllo = (l.steps ?? []).find((p) => p.id === 'chiavi');
    expect(controllo?.run, 'manca il passo che guarda quali chiavi di prova ci sono').toBeTruthy();
    const casi: Array<{ stripe: string; conto: string; carta: string; bonifico: string }> = [
      { stripe: '', conto: '', carta: 'no', bonifico: 'no' },
      { stripe: 'sk_live_chiave_vera', conto: 'acct_x', carta: 'no', bonifico: 'no' },
      { stripe: 'sk_test_x', conto: '', carta: 'si', bonifico: 'no' },
      { stripe: 'sk_test_x', conto: 'acct_x', carta: 'si', bonifico: 'si' },
    ];
    for (const c of casi) {
      const uscite = join(process.env.TMPDIR ?? '/tmp', `r29-chiavi-${process.pid}-${c.carta}${c.bonifico}${c.stripe.length}`);
      const giro = spawnSync('bash', ['-e', '-c', `: > "$GITHUB_OUTPUT"\n${controllo!.run}\ncat "$GITHUB_OUTPUT"\nrm -f "$GITHUB_OUTPUT"\n`], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: uscite, STRIPE_PROVA: c.stripe, CONTO_PROVA: c.conto } as unknown as NodeJS.ProcessEnv,
      });
      expect(giro.status, `con stripe=«${c.stripe}» conto=«${c.conto}» il controllo delle chiavi è rosso:\n${giro.stderr}`).toBe(0);
      expect(giro.stdout).toContain(`carta=${c.carta}`);
      expect(giro.stdout).toContain(`bonifico=${c.bonifico}`);
    }
  });

  it('al sito arriva solo la chiave Stripe di prova, e nessun segreto del database vero', () => {
    const l = ilLavoro();
    const testo = JSON.stringify(l);
    expect(testo).toMatch(/secrets\.STRIPE_TEST_SECRET_KEY/);
    expect(testo, 'la chiave vera di Stripe non entra nelle prove').not.toMatch(/secrets\.STRIPE_SECRET_KEY\b/);
    expect(testo, 'il database delle prove è quello locale').not.toMatch(/secrets\.(SUPABASE_DB_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_TEST_SERVICE_ROLE_KEY)\b/);
    const chiave = String(passoDelleProve(l).env?.STRIPE_SECRET_KEY ?? '');
    expect(chiave, 'la chiave arriva al sito solo dopo il controllo sk_test_').toMatch(/steps\.chiavi\.outputs\.carta == 'si'/);
  });

  it('dice sempre, nel riepilogo, cosa ha visto la cassa vera, e il cancello di main lo aspetta', () => {
    const l = ilLavoro();
    const riepilogo = (l.steps ?? []).find((p) => typeof p.run === 'string' && /GITHUB_STEP_SUMMARY/.test(p.run) && /acquisto vero/i.test(p.run));
    expect(riepilogo, 'nessun passo scrive nel riepilogo quali delle tre prove sono passate').toBeTruthy();
    expect(String(riepilogo!.if ?? ''), 'il riepilogo non gira sempre: col rosso sparirebbe').toMatch(/always\(\)/);
    const cancello = flusso().jobs?.['cancello-main'];
    const aspetta = Array.isArray(cancello?.needs) ? cancello!.needs : cancello?.needs ? [cancello.needs] : [];
    expect(aspetta, 'il cancello di main non aspetta la cassa vera').toContain(LAVORO);
  });
});
