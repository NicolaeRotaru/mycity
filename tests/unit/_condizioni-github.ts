import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * 16/10/2026 — LE CONDIZIONI DEL LAVORO DI RILASCIO, CALCOLATE COME LE CALCOLA GITHUB.
 *
 * Il difetto che ha reso necessario questo file: il rilascio dopo la CI partiva
 * per qualunque CI verde su un ramo CHIAMATO main, anche quella di una richiesta
 * di unione arrivata da una copia del deposito. Il buco stava tutto nelle righe
 * `if:` del file YAML, e una riga `if:` non si prova cercandoci dentro una
 * parola: una parola giusta dentro una condizione sbagliata passa lo stesso.
 *
 * Qui le condizioni si VALUTANO. Un piccolo valutatore delle espressioni di
 * GitHub (`==`, `!=`, `&&`, `||`, `!`, parentesi, `always()`, `success()`,
 * `failure()`, `cancelled()`) con le stesse regole del manuale: le stringhe si
 * confrontano senza badare alle maiuscole, tipi diversi diventano numeri, una
 * proprieta' che non c'e' vale null, e una condizione di passo senza funzioni di
 * stato ha davanti un `success()` implicito. Tutto il resto (altre funzioni,
 * altri operatori) alza un'eccezione: una prova che non capisce una condizione
 * deve diventare rossa, non far finta che sia vera o falsa.
 *
 * Il file si legge con un vero lettore YAML, come lo legge GitHub.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

export type PassoYaml = {
  name?: string;
  id?: string;
  if?: unknown;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
  'continue-on-error'?: unknown;
};

export type LavoroYaml = { if?: unknown; steps?: PassoYaml[] };

const PERCORSO = join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml');

/** Il lavoro che rilascia, letto dal file vero. */
export function lavoroDiRilascio(): LavoroYaml {
  const documento = yaml.load(readFileSync(PERCORSO, 'utf8')) as { jobs?: Record<string, LavoroYaml> };
  const lavoro = documento?.jobs?.vercel;
  if (!lavoro?.steps || lavoro.steps.length < 6) {
    throw new Error('Non trovo il lavoro «vercel» con i suoi passi in .github/workflows/deploy-dopo-ci.yml');
  }
  return lavoro;
}

// ── Il valutatore ────────────────────────────────────────────────────────────

type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenizza(testo: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < testo.length) {
    const c = testo[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= testo.length) throw new Error(`Stringa non chiusa in: ${testo}`);
        if (testo[i] === "'") {
          if (testo[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += testo[i++];
      }
      tokens.push({ t: 'str', v });
      continue;
    }
    const due = testo.slice(i, i + 2);
    if (['==', '!=', '&&', '||', '<=', '>='].includes(due)) {
      tokens.push({ t: 'op', v: due });
      i += 2;
      continue;
    }
    if ('()!.,[]<>'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    const numero = /^-?\d+(\.\d+)?/.exec(testo.slice(i));
    if (numero) {
      tokens.push({ t: 'num', v: Number(numero[0]) });
      i += numero[0].length;
      continue;
    }
    const nome = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(testo.slice(i));
    if (nome) {
      tokens.push({ t: 'id', v: nome[0] });
      i += nome[0].length;
      continue;
    }
    throw new Error(`Carattere che non so leggere («${c}») in: ${testo}`);
  }
  return tokens;
}

type Nodo =
  | { k: 'lett'; v: unknown }
  | { k: 'via'; base: string; parti: string[] }
  | { k: 'chiama'; nome: string; argomenti: Nodo[] }
  | { k: 'non'; dentro: Nodo }
  | { k: 'bin'; op: string; a: Nodo; b: Nodo };

function analizza(testo: string): Nodo {
  const tokens = tokenizza(testo);
  let p = 0;
  const guarda = () => tokens[p];
  const prendi = () => tokens[p++];
  const atteso = (v: string) => {
    const t = prendi();
    if (!t || t.t !== 'op' || t.v !== v) throw new Error(`Mi aspettavo «${v}» in: ${testo}`);
  };

  function oppure(): Nodo {
    let a = e();
    while (guarda()?.t === 'op' && guarda().v === '||') {
      prendi();
      a = { k: 'bin', op: '||', a, b: e() };
    }
    return a;
  }
  function e(): Nodo {
    let a = uguale();
    while (guarda()?.t === 'op' && guarda().v === '&&') {
      prendi();
      a = { k: 'bin', op: '&&', a, b: uguale() };
    }
    return a;
  }
  function uguale(): Nodo {
    let a = unario();
    while (guarda()?.t === 'op' && ['==', '!='].includes(String(guarda().v))) {
      const op = String(prendi().v);
      a = { k: 'bin', op, a, b: unario() };
    }
    const t = guarda();
    if (t?.t === 'op' && ['<', '>', '<=', '>='].includes(String(t.v))) {
      throw new Error(`L'operatore «${t.v}» non lo so valutare: ${testo}`);
    }
    return a;
  }
  function unario(): Nodo {
    const t = guarda();
    if (t?.t === 'op' && t.v === '!') {
      prendi();
      return { k: 'non', dentro: unario() };
    }
    return primario();
  }
  function primario(): Nodo {
    const t = prendi();
    if (!t) throw new Error(`Espressione finita troppo presto: ${testo}`);
    if (t.t === 'str' || t.t === 'num') return { k: 'lett', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const dentro = oppure();
      atteso(')');
      return dentro;
    }
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lett', v: true };
      if (t.v === 'false') return { k: 'lett', v: false };
      if (t.v === 'null') return { k: 'lett', v: null };
      if (guarda()?.t === 'op' && guarda().v === '(') {
        prendi();
        const argomenti: Nodo[] = [];
        if (!(guarda()?.t === 'op' && guarda().v === ')')) {
          argomenti.push(oppure());
          while (guarda()?.t === 'op' && guarda().v === ',') {
            prendi();
            argomenti.push(oppure());
          }
        }
        atteso(')');
        return { k: 'chiama', nome: t.v.toLowerCase(), argomenti };
      }
      const parti: string[] = [];
      while (guarda()?.t === 'op' && guarda().v === '.') {
        prendi();
        const n = prendi();
        if (!n || n.t !== 'id') throw new Error(`Dopo il punto mi aspettavo un nome: ${testo}`);
        parti.push(n.v);
      }
      if (guarda()?.t === 'op' && guarda().v === '[') throw new Error(`Gli indici [ ] non li so valutare: ${testo}`);
      return { k: 'via', base: t.v, parti };
    }
    throw new Error(`Non so leggere «${t.v}» in: ${testo}`);
  }

  const radice = oppure();
  if (p !== tokens.length) throw new Error(`Avanza qualcosa dopo l'espressione: ${testo}`);
  return radice;
}

const FUNZIONI_DI_STATO = new Set(['always', 'success', 'failure', 'cancelled']);

function usaStato(n: Nodo): boolean {
  switch (n.k) {
    case 'chiama':
      return FUNZIONI_DI_STATO.has(n.nome) || n.argomenti.some(usaStato);
    case 'non':
      return usaStato(n.dentro);
    case 'bin':
      return usaStato(n.a) || usaStato(n.b);
    default:
      return false;
  }
}

/** Vero/falso come li intende GitHub: falsi sono false, 0, '', null e NaN. */
export function vero(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v !== '';
  return true;
}

function comeNumero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v.trim());
  return Number.NaN;
}

function uguali(a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (typeof na === 'string' && typeof nb === 'string') return na.toLowerCase() === nb.toLowerCase();
  if (na === null && nb === null) return true;
  if (typeof na === typeof nb && typeof na !== 'object') return na === nb;
  if (typeof na === 'object' && typeof nb === 'object') return na === nb;
  const x = comeNumero(na);
  const y = comeNumero(nb);
  return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
}

/** Le proprieta' di GitHub non badano alle maiuscole; quella che non c'e' vale null. */
function proprieta(oggetto: unknown, nome: string): unknown {
  if (oggetto === null || typeof oggetto !== 'object') return null;
  const chiave = Object.keys(oggetto).find((k) => k.toLowerCase() === nome.toLowerCase());
  return chiave === undefined ? null : (oggetto as Record<string, unknown>)[chiave];
}

export type Stato = { fallitoPrima: boolean };

function valuta(n: Nodo, contesto: Record<string, unknown>, stato: Stato): unknown {
  switch (n.k) {
    case 'lett':
      return n.v;
    case 'via': {
      let v = proprieta(contesto, n.base);
      for (const parte of n.parti) v = proprieta(v, parte);
      return v;
    }
    case 'chiama':
      if (n.nome === 'always') return true;
      if (n.nome === 'success') return !stato.fallitoPrima;
      if (n.nome === 'failure') return stato.fallitoPrima;
      if (n.nome === 'cancelled') return false;
      throw new Error(`La funzione «${n.nome}()» non la so valutare`);
    case 'non':
      return !vero(valuta(n.dentro, contesto, stato));
    case 'bin': {
      if (n.op === '&&') {
        const a = valuta(n.a, contesto, stato);
        return vero(a) ? valuta(n.b, contesto, stato) : a;
      }
      if (n.op === '||') {
        const a = valuta(n.a, contesto, stato);
        return vero(a) ? a : valuta(n.b, contesto, stato);
      }
      const a = valuta(n.a, contesto, stato);
      const b = valuta(n.b, contesto, stato);
      if (n.op === '==') return uguali(a, b);
      if (n.op === '!=') return !uguali(a, b);
      throw new Error(`Operatore sconosciuto ${n.op}`);
    }
  }
}

function senzaGraffe(testo: string): string {
  const t = testo.trim();
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(t);
  return m ? m[1] : t;
}

/**
 * Il valore di un'espressione (con o senza `${{ }}`). Per le condizioni usa
 * `condizioneVera`, che aggiunge il `success()` implicito.
 */
export function valore(espressione: string, contesto: Record<string, unknown>, stato: Stato = { fallitoPrima: false }): unknown {
  return valuta(analizza(senzaGraffe(espressione)), contesto, stato);
}

/**
 * Una riga `if:` come la decide GitHub. Senza la riga, o senza funzioni di
 * stato dentro, vale `success() && (...)`.
 */
export function condizioneVera(se: unknown, contesto: Record<string, unknown>, stato: Stato = { fallitoPrima: false }): boolean {
  if (se === undefined || se === null || String(se).trim() === '') return !stato.fallitoPrima;
  if (typeof se === 'boolean') return se && !stato.fallitoPrima;
  const albero = analizza(senzaGraffe(String(se)));
  const esito = vero(valuta(albero, contesto, stato));
  return usaStato(albero) ? esito : esito && !stato.fallitoPrima;
}

/** Sostituisce ogni `${{ ... }}` dentro un valore di `env:`, come fa GitHub. */
export function interpola(testo: unknown, contesto: Record<string, unknown>): string {
  return String(testo ?? '').replace(/\$\{\{([\s\S]*?)\}\}/g, (_, dentro: string) => {
    const v = valore(dentro, contesto);
    return v === null || v === undefined ? '' : String(v);
  });
}

// ── Il percorso dei passi ────────────────────────────────────────────────────

export type EsitoFinto = { esito: 'success' | 'failure'; output?: Record<string, string> };

/**
 * Percorre i passi del lavoro nell'ordine del file e dice quali GIREREBBERO.
 * Ogni passo che gira prende l'esito scritto in `esiti` (per nome), oppure
 * «success» senza uscite. Un passo fallito senza `continue-on-error` fa
 * diventare falso `success()` per tutti quelli dopo, come su GitHub.
 */
export function percorso(passi: PassoYaml[], github: Record<string, unknown>, esiti: Record<string, EsitoFinto>): string[] {
  const steps: Record<string, unknown> = {};
  const stato: Stato = { fallitoPrima: false };
  const girati: string[] = [];
  for (const p of passi) {
    const nome = p.name ?? p.uses ?? '(senza nome)';
    const gira = condizioneVera(p.if, { github, steps }, stato);
    if (!gira) {
      if (p.id) steps[p.id] = { outputs: {}, outcome: 'skipped', conclusion: 'skipped' };
      continue;
    }
    girati.push(nome);
    const finto = esiti[nome] ?? { esito: 'success' as const };
    if (p.id) steps[p.id] = { outputs: finto.output ?? {}, outcome: finto.esito, conclusion: finto.esito };
    if (finto.esito === 'failure' && !vero(p['continue-on-error'])) stato.fallitoPrima = true;
  }
  return girati;
}

/**
 * Il contesto `github` di un'esecuzione partita da `workflow_run`, con i campi
 * che GitHub mette nell'evento. Si cambia solo cio' che serve alla scena.
 */
export function eventoDopoLaCi(campi: {
  conclusion?: string;
  event?: string;
  headRepository?: string;
  headBranch?: string;
  headSha?: string;
} = {}): Record<string, unknown> {
  return {
    event_name: 'workflow_run',
    repository: 'NicolaeRotaru/mycity',
    sha: 'cccccccccccccccccccccccccccccccccccccccc',
    ref: 'refs/heads/main',
    event: {
      workflow_run: {
        name: 'CI',
        conclusion: campi.conclusion ?? 'success',
        event: campi.event ?? 'push',
        head_branch: campi.headBranch ?? 'main',
        head_sha: campi.headSha ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        head_repository: { full_name: campi.headRepository ?? 'NicolaeRotaru/mycity' },
        repository: { full_name: 'NicolaeRotaru/mycity' },
      },
    },
  };
}
