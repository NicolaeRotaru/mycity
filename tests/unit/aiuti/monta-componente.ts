/**
 * MONTARE UN COMPONENTE IN UNA PROVA.
 *
 * In questa repo `tsconfig.json` dichiara `jsx: "preserve"`, quindi vitest non
 * riesce a leggere un `.tsx`: fino a oggi nessuna prova poteva montare un
 * componente, e i difetti di accessibilità finivano «provati» cercando una
 * parola in un file — che qui non vale come prova.
 *
 * Qui il componente viene compilato per davvero (in un processo a parte, perché
 * esbuild non parte dentro jsdom), poi renderizzato, poi interrogato come lo
 * interrogherebbe un lettore di schermo: il NOME che una persona cieca sente.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
const RADICE = path.resolve(__dirname, '../../..');
/**
 * Dove finiscono i componenti compilati: dentro il progetto, non in
 * `node_modules` — fuori, vitest non trasforma il file e i pacchetti CommonJS
 * (react in testa) perdono metà dei loro nomi, e `import { use } from 'react'`
 * non si risolve più.
 *
 * Una cartella per processo — vitest fa girare più file di prova in parallelo e
 * nessuno deve poter pestare i piedi a un altro — e il file compilato si
 * cancella appena è stato caricato: da lì in poi vive in memoria. Quello che
 * resta sul disco è una cartella vuota, che git non vede.
 */
const CASSETTO = path.join(RADICE, 'tests', 'unit', '.montati', String(process.pid));



const montati = new Map<string, Promise<Record<string, unknown>>>();

/** Compila e carica un componente della repo. Il risultato è il modulo vero. */
export function monta(fileRelativo: string): Promise<Record<string, unknown>> {
  const gia = montati.get(fileRelativo);
  if (gia) return gia;
  const promessa = (async () => {
    if (!existsSync(CASSETTO)) mkdirSync(CASSETTO, { recursive: true });
    const nome = fileRelativo.replace(/[^a-zA-Z0-9]+/g, '-') + '.mjs';
    const uscita = path.join(CASSETTO, nome);
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'compila.mjs'), fileRelativo, uscita],
      { cwd: RADICE, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const modulo = (await import(/* @vite-ignore */ uscita)) as Record<string, unknown>;
    // Caricato: sul disco non serve più.
    try {
      rmSync(uscita, { force: true });
      rmSync(CASSETTO, { recursive: false });
    } catch {
      /* la cartella non è vuota perché un altro pezzo è ancora in coda: va bene così */
    }
    return modulo;
  })();
  montati.set(fileRelativo, promessa);
  return promessa;
}

/**
 * Il testo che un lettore di schermo legge dentro un elemento: via le icone e
 * tutto ciò che è nascosto alle tecnologie assistive. I pezzi si uniscono con
 * uno spazio, come li scandisce un lettore — «Consegna a Piacenza», non
 * «Consegna aPiacenza».
 */
export function testoVisibile(el: Element | null): string {
  if (!el) return '';
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll('[aria-hidden="true"], [aria-hidden=""], svg, script, style').forEach((n) => n.remove());
  const pezzi: string[] = [];
  const cammina = (n: Node) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) pezzi.push(t);
      return;
    }
    n.childNodes.forEach(cammina);
  };
  cammina(copia);
  return pezzi.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Il NOME ACCESSIBILE di un controllo, calcolato come lo calcola un browser:
 * aria-labelledby → aria-label → <label for>/<label> che lo avvolge (solo per i
 * campi, MAI per un <button>) → contenuto → title. La scritta-suggerimento
 * dentro un campo non conta: sparisce appena si scrive.
 * È volutamente semplificato, ma sui punti che qui contano non mente.
 */
export function nomeAccessibile(el: Element): string {
  const doc = el.ownerDocument;
  const daId = el.getAttribute('aria-labelledby');
  if (daId) {
    const pezzi = daId
      .split(/\s+/)
      .map((id) => testoVisibile(doc.getElementById(id)))
      .filter(Boolean);
    if (pezzi.length) return pezzi.join(' ');
  }
  const etichetta = el.getAttribute('aria-label');
  if (etichetta && etichetta.trim()) return etichetta.trim();

  const tag = el.tagName.toLowerCase();
  const prendeLabel = tag === 'input' || tag === 'select' || tag === 'textarea';
  if (prendeLabel) {
    const id = el.getAttribute('id');
    if (id) {
      // Niente selettore CSS: gli id che React genera con useId contengono i
      // due punti, che in un selettore andrebbero protetti a mano.
      const l = Array.from(doc.querySelectorAll('label[for]')).find(
        (x) => x.getAttribute('for') === id,
      );
      const t = testoVisibile(l ?? null);
      if (t) return t;
    }
    const avvolge = el.closest('label');
    const t = testoVisibile(avvolge);
    if (t) return t;
  } else {
    const contenuto = testoVisibile(el);
    if (contenuto) return contenuto;
  }

  const titolo = el.getAttribute('title');
  if (titolo && titolo.trim()) return titolo.trim();
  // La scritta-suggerimento dentro un campo NON conta come nome: sparisce alla
  // prima lettera digitata, e chi torna sul campo non sa più cosa ci va.
  return '';
}

/** I controlli di una pagina (o di un pezzo di pagina) che un lettore deve poter nominare. */
export function controlli(radice: Document | Element): Element[] {
  return Array.from(
    radice.querySelectorAll('button, select, textarea, a[href], input:not([type="hidden"])'),
  ).filter((el) => !el.closest('[aria-hidden="true"]'));
}
