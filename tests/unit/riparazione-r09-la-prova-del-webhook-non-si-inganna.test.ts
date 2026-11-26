import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 26/11/2026 — LA PROVA DELL'ANTI-DOPPIONE NON SI INGANNA CON UNO SPAZIO.
 *
 * `webhook-diviso-per-mestiere.test.ts` controlla che la rotta del webhook di Stripe segni
 * l'evento come lavorato (`processed: true`) solo dopo il gestore. Lo faceva cercando la parola
 * `processed: true`: una marcatura spostata prima di `switch (event.type)` e scritta
 * `processed:true` (senza spazio), o in un'altra forma, non la vedeva, e la prova restava verde.
 *
 * 26/11/2026 sera (R26-003) — QUESTA GUARDIA NON CONTROLLAVA NIENTE: ADESSO PUÒ DIVENTARE ROSSA.
 * Faceva girare quella prova in tre vitest figli, filtrati con `-t 'anti-doppione'`: il filtro
 * prendeva anche il caso «meno di 250 righe», e la rotta ne ha 249. Ogni copia guastata (una riga
 * in più) diventava rossa per il numero di righe, non per la marcatura: rimessa la ricerca della
 * parola, la guardia restava verde. Adesso niente processi figli: la funzione che legge la rotta
 * sull'albero (`marcatureDellaRotta`, in webhook-diviso-per-mestiere.test.ts) si prende dal suo
 * file, si esegue sulle copie guastate della rotta vera, scritte qui in memoria, e su ognuna deve
 * trovare la marcatura fuori posto. La rotta vera non si tocca, e il numero di righe non conta.
 */

const RADICE = process.cwd();
const VERA = readFileSync(join(RADICE, 'app/api/stripe/webhook/route.ts'), 'utf8');
const PROVA = readFileSync(join(RADICE, 'tests/unit/webhook-diviso-per-mestiere.test.ts'), 'utf8');
const ALBERO_DELLA_PROVA = ts.createSourceFile('prova.ts', PROVA, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

type Esito = { smistamento: boolean; dopo: number; fuoriPosto: string[] };

/** La funzione della prova, presa dal suo file ed eseguita qui (ha bisogno solo di `ts`). */
function letturaDellaProva(): ((testo: string) => Esito) | undefined {
  const f = ALBERO_DELLA_PROVA.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'marcatureDellaRotta',
  );
  if (!f) return undefined;
  const js = ts.transpileModule(f.getText(ALBERO_DELLA_PROVA), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('ts', `${js}\nreturn marcatureDellaRotta;`)(ts) as (testo: string) => Esito;
}

const SMISTAMENTO = '    switch (event.type) {\n';
const ERRORE = "    logger.error(err, { context: 'stripe-webhook-handler' });\n";
const GESTORE_DEL_RIMBORSO = '        await handleChargeRefunded(charge);\n';
const FINE_DEL_CATCH = "    return NextResponse.json({ error: 'Handler error' }, { status: 500 });\n  }\n";
const MARCATURA_DOPO = [
  '    scritturaSenzaRipetere(await admin\n',
  "      .from('stripe_event_log')\n",
  '      .update({ processed: true, processed_at: new Date().toISOString() })\n',
  "      .eq('event_id', event.id), 'evento segnato come lavorato');\n",
].join('');

/** La rotta vera con `aggiunta` scritta subito prima di `prima`. */
function guasta(prima: string, aggiunta: string, rotta = VERA): string {
  expect(rotta.split(prima).length, `la rotta non ha più un pezzo solo «${prima.trim()}»`).toBe(2);
  return rotta.replace(prima, aggiunta + prima);
}
const segna = (oggetto: string) => `    await admin.from('stripe_event_log').update(${oggetto}).eq('event_id', event.id);\n`;

/** Le copie guastate: ognuna segna l'evento come lavorato prima che il gestore sia riuscito. */
const GUASTE: Array<[string, () => string]> = [
  ['prima dello smistamento, «processed:true» senza spazio', () => guasta(SMISTAMENTO, segna('{ processed:true, processed_at: new Date().toISOString() }'))],
  ['nel ramo dell errore, andando a capo e tra virgolette', () => guasta(ERRORE, segna("{\n      'processed':\n        true,\n    }"))],
  ['prima dello smistamento, nella forma breve { processed }', () => guasta(SMISTAMENTO, `    const processed = true;\n${segna('{ processed }')}`)],
  ['prima dello smistamento, con la chiave calcolata [\'processed\']', () => guasta(SMISTAMENTO, segna("{ ['processed']: true }"))],
  ['prima dello smistamento, con la chiave calcolata [`processed`]', () => guasta(SMISTAMENTO, segna('{ [`processed`]: true }'))],
  ['prima dello smistamento, assegnata a una riga (riga.processed = true)', () => guasta(SMISTAMENTO, `    const riga = { processed: false };\n    riga.processed = true;\n${segna('riga')}`)],
  ['dentro un case, prima del suo gestore', () => guasta(GESTORE_DEL_RIMBORSO, `    ${segna('{ processed: true }')}`)],
  ['nel finally, che gira anche quando il gestore fallisce', () => {
    expect(VERA.split(FINE_DEL_CATCH).length, 'la rotta non finisce più col ramo dell errore di sempre').toBe(2);
    return VERA.replace(FINE_DEL_CATCH, FINE_DEL_CATCH.replace(/ {2}\}\n$/, `  } finally {\n${segna('{ processed: true }')}  }\n`));
  }],
];

describe('R09-003 · la prova dell anti-doppione vede la marcatura comunque sia scritta', () => {
  it('la prova dell anti-doppione legge la rotta con la funzione sull albero, e ne controlla l esito', () => {
    const lettura = letturaDellaProva();
    expect(lettura, 'webhook-diviso-per-mestiere.test.ts non legge più la rotta sull albero (marcatureDellaRotta)').toBeDefined();
    const casi: string[] = [];
    const visita = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'it' && ts.isStringLiteral(n.arguments[0])) {
        const corpo = n.arguments[1]?.getText(ALBERO_DELLA_PROVA) ?? '';
        if (/marcatureDellaRotta\(/.test(corpo) && /fuoriPosto/.test(corpo) && /dopo/.test(corpo)) casi.push(n.arguments[0].text);
      }
      ts.forEachChild(n, visita);
    };
    visita(ALBERO_DELLA_PROVA);
    expect(casi, 'nessun caso della prova usa marcatureDellaRotta controllando marcature fuori posto e marcatura dopo').toHaveLength(1);
  });

  it('controprova: sulla rotta vera nessuna marcatura fuori posto, e una dopo lo smistamento', () => {
    const lettura = letturaDellaProva();
    expect(lettura).toBeDefined();
    const e = lettura!(VERA);
    expect(e.smistamento).toBe(true);
    expect(e.fuoriPosto).toEqual([]);
    expect(e.dopo).toBeGreaterThan(0);
  });

  for (const [come, rotta] of GUASTE) {
    it(`marcata ${come}: la prova la vede fuori posto`, () => {
      const lettura = letturaDellaProva();
      expect(lettura).toBeDefined();
      const copia = rotta();
      const sintassi = ts.transpileModule(copia, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? [];
      expect(sintassi.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), 'la copia guastata non è codice valido: il caso non misura niente').toEqual([]);
      const e = lettura!(copia);
      expect(e.smistamento, 'la copia guastata non ha più lo smistamento: il caso non misura niente').toBe(true);
      expect(e.fuoriPosto.length, `marcata ${come}, e la prova non la vede`).toBeGreaterThan(0);
    });
  }

  it('spostata da dopo a prima dello smistamento: fuori posto, e dopo non resta niente', () => {
    const lettura = letturaDellaProva();
    expect(lettura).toBeDefined();
    expect(VERA.split(MARCATURA_DOPO).length, 'la marcatura dopo lo smistamento non è più quella di sempre').toBe(2);
    const spostata = guasta(SMISTAMENTO, MARCATURA_DOPO, VERA.replace(MARCATURA_DOPO, ''));
    const e = lettura!(spostata);
    expect(e.fuoriPosto.length).toBeGreaterThan(0);
    expect(e.dopo).toBe(0);
    expect(lettura!(VERA.replace(MARCATURA_DOPO, '')).dopo, 'tolta la marcatura dopo, l evento non si segna più').toBe(0);
  });
});
