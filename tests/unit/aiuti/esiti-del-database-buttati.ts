/**
 * Il controllo per TIPI degli esiti del database buttati via, nei gestori di
 * Stripe (R81, secondo giro di collaudo).
 *
 * Il controllo di stile (`.eslintrc.json`) riconosce le forme SCRITTE di una
 * scrittura col risultato non letto: `await admin.from(..).update(..)` e
 * qualche parente. Il collaudo del 15/10 ne ha fatte passare quattro su sei:
 * scritture dentro `Promise.all`, una funzione del database (`rpc`), un
 * aiutante che restituisce l'esito e viene ignorato, una richiesta costruita in
 * due tempi. E una di queste c'era già nel codice (la merce rimessa a scaffale
 * nel rimborso pieno). È la scorciatoia n. 11 del catalogo: un metro che
 * riconosce una forma scritta, e dà per assente quello che non sa leggere.
 *
 * Questo controllo non guarda come è scritta la riga: chiede a TypeScript che
 * cosa VALE. Un'istruzione che aspetta qualcosa e butta via il risultato, se
 * quel risultato porta un `error` del database (`PostgrestError`, o un
 * `error: unknown` di un aiutante), è un esito buttato — in qualunque forma sia
 * scritto. E un risultato di tipo `any` non si dà per buono: si conta come
 * «non so leggerlo», perché è lì che un metro si fa cieco senza dirlo.
 */
import ts from 'typescript';
import { join, relative } from 'node:path';

export type EsitoButtato = { file: string; riga: number; motivo: string; testo: string };
export type Referto = { trovati: EsitoButtato[]; esaminate: number; file: number };

/** I metodi che scrivono, sulla catena di una richiesta al database. */
const SCRIVE = /^(insert|update|upsert|delete|rpc)$/;

function senzaParentesi(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/**
 * Crea il programma TypeScript con la configurazione vera della casa. I file
 * `sonde` esistono solo in memoria: servono alle prove per mettere un pezzetto
 * di codice dentro la cartella dei gestori senza scriverlo sul disco.
 */
export function programmaDeiGestori(radice: string, file: string[], sonde: Record<string, string> = {}): ts.Program {
  const letto = ts.readConfigFile(join(radice, 'tsconfig.json'), ts.sys.readFile);
  const opzioni = { ...ts.parseJsonConfigFileContent(letto.config, ts.sys, radice).options, incremental: false, noEmit: true };
  const ospite = ts.createCompilerHost(opzioni);
  const leggiFile = ospite.readFile.bind(ospite);
  const esisteFile = ospite.fileExists.bind(ospite);
  const prendiSorgente = ospite.getSourceFile.bind(ospite);
  ospite.readFile = (f) => sonde[f] ?? leggiFile(f);
  ospite.fileExists = (f) => f in sonde || esisteFile(f);
  ospite.getSourceFile = (f, v, ...resto) =>
    f in sonde ? ts.createSourceFile(f, sonde[f], v) : prendiSorgente(f, v, ...resto);
  return ts.createProgram([...file, ...Object.keys(sonde)], opzioni, ospite);
}

export function cercaEsitiButtati(programma: ts.Program, radice: string, file: string[]): Referto {
  const tipi = programma.getTypeChecker();
  const trovati: EsitoButtato[] = [];
  let esaminate = 0;

  /** Il tipo porta un errore del database? Guarda dentro le unioni e gli elenchi. */
  const portaErrore = (tipo: ts.Type, dove: ts.Node): boolean => {
    if (tipo.isUnion()) return tipo.types.some((t) => portaErrore(t, dove));
    if (tipi.isArrayType(tipo) || tipi.isTupleType(tipo)) {
      return tipi.getTypeArguments(tipo as ts.TypeReference).some((t) => portaErrore(t, dove));
    }
    const errore = tipo.getProperty('error');
    if (!errore) return false;
    const testo = tipi.typeToString(tipi.getTypeOfSymbolAtLocation(errore, dove));
    return testo.includes('PostgrestError') || testo === 'unknown';
  };
  const eAny = (tipo: ts.Type) => (tipo.flags & ts.TypeFlags.Any) !== 0;

  /** La catena (anche costruita in due tempi, un passo indietro) contiene una scrittura? */
  const catenaScrive = (e: ts.Expression, passi = 0): boolean | 'non-so' => {
    const x = senzaParentesi(e);
    if (ts.isCallExpression(x)) {
      const chi = x.expression;
      if (ts.isPropertyAccessExpression(chi)) {
        if (SCRIVE.test(chi.name.text)) return true;
        // `.from(...)` è l'inizio della richiesta: dopo non c'era nessuna scrittura.
        if (chi.name.text === 'from') return false;
        return catenaScrive(chi.expression, passi);
      }
      return 'non-so'; // un aiutante: da fuori non si sa se scrive
    }
    if (ts.isIdentifier(x) && passi < 2) {
      const simbolo = tipi.getSymbolAtLocation(x);
      const dichiarazione = simbolo?.valueDeclaration;
      if (dichiarazione && ts.isVariableDeclaration(dichiarazione) && dichiarazione.initializer) {
        return catenaScrive(dichiarazione.initializer, passi + 1);
      }
    }
    return false;
  };

  for (const percorso of file) {
    const sorgente = programma.getSourceFile(percorso);
    if (!sorgente) throw new Error(`file non trovato dal compilatore: ${percorso}`);
    const segna = (n: ts.Node, motivo: string) =>
      trovati.push({
        file: relative(radice, percorso),
        riga: sorgente.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        motivo,
        testo: n.getText().replace(/\s+/g, ' ').slice(0, 120),
      });

    const visita = (n: ts.Node): void => {
      // ① Un'istruzione che aspetta (o lascia correre) qualcosa e butta via il risultato.
      if (ts.isExpressionStatement(n)) {
        const e = senzaParentesi(n.expression);
        const assegna = ts.isBinaryExpression(e) && e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          e.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        if (!assegna) {
          const tipo = tipi.getTypeAtLocation(ts.isAwaitExpression(e) ? e.expression : e);
          const atteso = tipi.getAwaitedType(tipo) ?? tipo;
          // Una chiamata sincrona che restituisce l'esito (scritturaObbligatoria)
          // l'ha già letto: conta solo ciò che si aspetta o che corre da solo.
          const promessa = ts.isAwaitExpression(e) || atteso !== tipo;
          if (promessa) {
            esaminate += 1;
            if (eAny(atteso)) segna(n, 'tipo sconosciuto (any): non so dire se è un esito del database');
            else if (portaErrore(atteso, n)) segna(n, 'esito del database buttato via');
          }
        }
      }
      // ② Chi legge i dati di una SCRITTURA e lascia l'errore per terra.
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
        const iniziale = senzaParentesi(n.initializer);
        if (ts.isAwaitExpression(iniziale)) {
          esaminate += 1;
          const atteso = tipi.getAwaitedType(tipi.getTypeAtLocation(iniziale.expression));
          const nomi = n.name.elements.map((el) => (el.propertyName ?? el.name).getText());
          if (atteso && portaErrore(atteso, n) && !nomi.includes('error')) {
            const scrive = catenaScrive(iniziale.expression);
            if (scrive === true) segna(n, 'scrittura: legge i dati e butta l errore');
            else if (scrive === 'non-so') segna(n, 'aiutante del database: legge i dati e butta l errore');
          }
        }
      }
      ts.forEachChild(n, visita);
    };
    visita(sorgente);
  }
  return { trovati, esaminate, file: file.length };
}
