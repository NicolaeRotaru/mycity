// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { aspetta, disegna, scrivi } from './aiuti/cabina-admin';
import { filtroNomeONegozio, modelloIlike } from '@/lib/admin/ricerca-prodotti';

/**
 * R05-005 (collaudo K03) — Il campo dei prodotti dell'admin dice «Cerca prodotto o negozio», ma
 * oltre i primi mille prodotti la ricerca nel database guardava solo il nome del prodotto:
 * cercando un negozio, i suoi prodotti più vecchi non uscivano. E se la ricerca cadeva, o si
 * fermava a 200, la pagina non lo diceva.
 *
 * Il finto server qui sotto fa come PostgREST nelle cose che contano: mai più di mille righe,
 * il conteggio esatto quando lo si chiede, `ilike` con `\` come segno di fuga e `*` letto come
 * `%`, e il filtro `or=(…)` letto con la sua grammatica — virgole e parentesi fuori dalle
 * virgolette separano le condizioni, e un filtro scritto male è un errore, non zero righe.
 */

type Riga = Record<string, unknown>;
type Condizione = (r: Riga) => boolean;
class ErroreDiSintassi extends Error {}

const finto = vi.hoisted(() => {
  const db = {
    products: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
    /** Le letture fatte: tabella e filtri, come arriverebbero nell'indirizzo. */
    richieste: [] as Array<{ tabella: string; filtri: string[] }>,
    /** Quali letture cadono (rete, permessi…): nessuna, se non lo dice la prova. */
    cade: null as null | ((tabella: string, filtri: string[]) => boolean),
  };
  return { db };
});

/** Il modello di LIKE come espressione regolare: `%` e `_` jolly, `\` toglie il jolly al segno dopo. */
function regolaLike(modello: string): RegExp {
  const sfuggi = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let re = '';
  for (let i = 0; i < modello.length; i++) {
    const c = modello[i];
    if (c === '\\') {
      i++;
      if (i >= modello.length) throw new ErroreDiSintassi('LIKE pattern must not end with escape character');
      re += sfuggi(modello[i]);
    } else if (c === '%') re += '[\\s\\S]*';
    else if (c === '_') re += '[\\s\\S]';
    else re += sfuggi(c);
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Come PostgREST: per like/ilike ogni `*` diventa `%`, anche tra virgolette. */
const ilike = (colonna: string, valore: string): Condizione => {
  const re = regolaLike(valore.replace(/\*/g, '%'));
  return (r) => typeof r[colonna] === 'string' && re.test(r[colonna] as string);
};

/** Un valore della grammatica dei filtri: tra virgolette (con `\` che protegge il segno dopo) o nudo fino a `,` o `)`. */
function leggiValore(testo: string, i: number): [string, number] {
  if (testo[i] === '"') {
    let v = '';
    i++;
    while (i < testo.length && testo[i] !== '"') {
      if (testo[i] === '\\') i++;
      if (i >= testo.length) break;
      v += testo[i];
      i++;
    }
    if (testo[i] !== '"') throw new ErroreDiSintassi('virgolette non chiuse');
    i++;
    if (i < testo.length && testo[i] !== ',' && testo[i] !== ')') throw new ErroreDiSintassi(`atteso «,» o «)» in ${i}`);
    return [v, i];
  }
  let v = '';
  while (i < testo.length && testo[i] !== ',' && testo[i] !== ')') v += testo[i++];
  return [v, i];
}

/** Il contenuto di `or=(…)`: condizioni `colonna.operatore.valore` separate da virgole. */
function leggiOr(testo: string): Condizione[] {
  const condizioni: Condizione[] = [];
  let i = 0;
  while (i < testo.length) {
    const m = /^([a-z_][a-z0-9_]*)\.(ilike|eq|in)\./.exec(testo.slice(i));
    if (!m) throw new ErroreDiSintassi(`failed to parse logic tree (${testo.slice(i, i + 20)})`);
    const [, colonna, operatore] = m;
    i += m[0].length;
    if (operatore === 'in') {
      if (testo[i] !== '(') throw new ErroreDiSintassi('atteso «(» dopo in');
      i++;
      const valori: string[] = [];
      for (;;) {
        const [v, j] = leggiValore(testo, i);
        valori.push(v);
        i = j;
        if (testo[i] === ',') { i++; continue; }
        if (testo[i] === ')') { i++; break; }
        throw new ErroreDiSintassi('lista in non chiusa');
      }
      condizioni.push((r) => valori.includes(String(r[colonna])));
    } else {
      const [v, j] = leggiValore(testo, i);
      i = j;
      condizioni.push(operatore === 'ilike' ? ilike(colonna, v) : (r) => String(r[colonna]) === v);
    }
    if (i === testo.length) break;
    if (testo[i] !== ',') throw new ErroreDiSintassi(`failed to parse logic tree: «${testo[i]}» inatteso in ${i}`);
    i++;
  }
  return condizioni;
}

function domanda(tabella: string) {
  const filtri: string[] = [];
  const condizioni: Condizione[] = [];
  let conta = false;
  let tetto = Infinity;
  let ordine: { colonna: string; crescente: boolean } | null = null;
  let errore: { code: string; message: string } | null = null;
  const q = {
    select: (_c?: string, o?: { count?: string }) => { conta = o?.count === 'exact'; return q; },
    order: (colonna: string, o?: { ascending?: boolean }) => { ordine = { colonna, crescente: o?.ascending !== false }; return q; },
    limit: (n: number) => { tetto = n; return q; },
    eq: (c: string, v: unknown) => { filtri.push(`${c}=eq.${String(v)}`); condizioni.push((r) => r[c] === v); return q; },
    ilike: (c: string, v: string) => {
      filtri.push(`${c}=ilike.${v}`);
      try { condizioni.push(ilike(c, v)); } catch (e) { errore = { code: '22025', message: (e as Error).message }; }
      return q;
    },
    or: (testo: string) => {
      filtri.push(`or=(${testo})`);
      try {
        const alternative = leggiOr(testo);
        condizioni.push((r) => alternative.some((c) => c(r)));
      } catch (e) {
        errore = { code: 'PGRST100', message: (e as Error).message };
      }
      return q;
    },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      finto.db.richieste.push({ tabella, filtri });
      const risposta = (() => {
        if (finto.db.cade?.(tabella, filtri)) return { data: null, error: { message: 'TypeError: Failed to fetch' }, count: null };
        if (errore) return { data: null, error: errore, count: null };
        let righe = ((finto.db as unknown as Record<string, Riga[]>)[tabella] ?? []).filter((r) => condizioni.every((c) => c(r)));
        if (ordine) {
          const { colonna, crescente } = ordine;
          righe = [...righe].sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : 1) * (crescente ? 1 : -1));
        }
        const totale = righe.length;
        return { data: righe.slice(0, Math.min(tetto, 1000)), error: null, count: conta ? totale : null };
      })();
      return Promise.resolve(risposta).then(ok, ko);
    },
  };
  return q;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => domanda(t), rpc: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FORNO = '00000000-0000-4000-8000-00000000f001';
const ORTO = '00000000-0000-4000-8000-00000000f002';
const MILLE = '00000000-0000-4000-8000-00000000f003';
const NEGOZI: Record<string, string> = {
  [FORNO]: 'Forno Rossi',
  [ORTO]: "L'Orto (di Verdi), 100% bio",
  [MILLE]: 'Verdi 1000 sapori',
};

const prodotto = (id: string, name: string, seller_id: string, created_at: string): Riga => ({
  id, name, price: 3, stock: 2, status: 'available', images: [], external_marketplace: null, external_synced_at: null,
  seller_id, created_at, seller: { store_name: NEGOZI[seller_id] }, categories: null,
});

/** 1.100 pani recenti del forno, e sotto — oltre le mille righe — i prodotti vecchi di due negozi. */
function catalogo(vecchiDellOrto: string[] = ['Miele di castagno', 'Farro perlato', 'Zucca mantovana']) {
  finto.db.profiles = Object.entries(NEGOZI).map(([id, store_name]) => ({ id, store_name }));
  finto.db.products = [
    ...Array.from({ length: 1100 }, (_, i) => prodotto(`pane-${i}`, `Pane ${i}`, FORNO, `2026-11-${String(10 + (i % 15)).padStart(2, '0')}T08:00:00Z`)),
    ...vecchiDellOrto.map((nome, i) => prodotto(`orto-${i}`, nome, ORTO, `2025-0${1 + (i % 9)}-15T08:00:00Z`)),
    prodotto('mille-0', 'Polenta taragna', MILLE, '2025-02-01T08:00:00Z'),
  ];
}

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  finto.db.richieste.length = 0;
  finto.db.cade = null;
});

async function apriECerca(testo: string) {
  const mod = (await import('@/app/admin/products/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  expect(r.host.textContent, 'il catalogo di prova deve superare il tetto').toContain('Elenco tagliato');
  const campo = r.host.querySelector('input[type="search"]') as HTMLInputElement;
  await scrivi(campo, testo);
  await aspetta(12);
  return r.host;
}

/** Le letture dei prodotti CON un filtro: quella dell'elenco non ne ha, sono quelle della ricerca. */
const richiesteProdottiCercati = () => finto.db.richieste.filter((q) => q.tabella === 'products' && q.filtri.length > 0);

describe('R05-005 — la ricerca dei prodotti dell admin trova anche il negozio, oltre le mille righe', () => {
  it('cercando un negozio escono i suoi prodotti più vecchi, che non stanno fra gli ultimi mille', async () => {
    catalogo();
    const host = await apriECerca('Verdi');
    const testo = host.textContent ?? '';
    for (const nome of ['Miele di castagno', 'Farro perlato', 'Zucca mantovana', 'Polenta taragna']) {
      expect(testo, `«${nome}» è di un negozio che si chiama «…Verdi…», ma la ricerca guarda solo il nome del prodotto`).toContain(nome);
    }
    expect(testo).toContain('4 di 1104');
    expect(testo).not.toContain('non è riuscita');
  });

  it('virgole, parentesi e jolly nel testo cercato non rompono il filtro e restano lettere', async () => {
    catalogo();
    const host = await apriECerca('(di Verdi), 100%');
    const testo = host.textContent ?? '';
    expect(testo, 'il filtro è stato spezzato dalla punteggiatura del testo cercato').not.toContain('non è riuscita');
    expect(testo).toContain('Miele di castagno');
    expect(testo).not.toContain('Polenta taragna');

    // «100%» deve volere dire «100%», non «100 e poi qualunque cosa»: «Verdi 1000 sapori» non c'entra.
    finto.db.richieste.length = 0;
    await scrivi(host.querySelector('input[type="search"]') as HTMLInputElement, '100%');
    await aspetta(12);
    const filtri = richiesteProdottiCercati().flatMap((q) => q.filtri).join(' ');
    expect(filtri).toContain(ORTO);
    expect(filtri, 'il % del testo cercato ha fatto da jolly e ha preso anche «Verdi 1000 sapori»').not.toContain(MILLE);
    expect(host.textContent).toContain('Miele di castagno');
  });

  it('se la ricerca nel database cade, la pagina lo dice invece di mostrare in silenzio solo gli ultimi mille', async () => {
    catalogo();
    // Cade ogni lettura che cerca (ha un filtro); l'elenco degli ultimi mille arriva.
    finto.db.cade = (_tabella, filtri) => filtri.length > 0;
    const host = await apriECerca('Verdi');
    expect(host.textContent).toContain('La ricerca nel database non è riuscita');
  });

  it('oltre i 200 trovati la pagina dice quanti sono davvero', async () => {
    catalogo(Array.from({ length: 250 }, (_, i) => `Conserva ${i}`));
    const host = await apriECerca('Verdi');
    expect(host.textContent, 'la ricerca si ferma a 200 senza dirlo').toMatch(/nel database ci sono 251 prodotti/);
  });
});

/**
 * Il filtro da solo, letto con la grammatica di PostgREST: qualunque testo diventa UNA condizione
 * sul nome (più quella sui negozi), e il testo resta lettera per lettera.
 */
describe('R05-005 — il filtro «prodotto o negozio» regge la punteggiatura', () => {
  const strano = 'a,b) c.d:e "f" 100%_\\x*(';

  it('il testo con virgole, parentesi, virgolette, jolly e barre non spezza il filtro', () => {
    const condizioni = leggiOr(filtroNomeONegozio(strano, [ORTO, MILLE]));
    expect(condizioni).toHaveLength(2);
    const [perNome, perNegozio] = condizioni;
    expect(perNome({ name: `Vaso ${strano.toUpperCase()} grande` })).toBe(true);
    expect(perNome({ name: 'Vaso a,b) c.d:e "f" 1000X\\xy( grande' })).toBe(false);
    expect(perNome({ name: 'a' })).toBe(false);
    expect(perNegozio({ seller_id: ORTO })).toBe(true);
    expect(perNegozio({ seller_id: FORNO })).toBe(false);
  });

  it('senza negozi resta solo la condizione sul nome, e `%` e `_` non fanno da jolly', () => {
    expect(leggiOr(filtroNomeONegozio('Verdi', []))).toHaveLength(1);
    const re = regolaLike(modelloIlike('5_%'));
    expect(re.test('sconto 5_% oggi')).toBe(true);
    expect(re.test('sconto 50% oggi')).toBe(false);
    expect(re.test('sconto 5_x oggi')).toBe(false);
  });
});
