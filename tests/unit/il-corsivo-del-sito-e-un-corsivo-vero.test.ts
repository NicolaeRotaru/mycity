/**
 * 3/9/2026 — IL CORSIVO DEL SITO ERA FINTO.
 *
 * Un carattere tipografico non è un solo disegno: la versione dritta e quella
 * inclinata sono due disegni diversi, e vanno scaricate tutte e due. In
 * `app/layout.tsx` chiedevamo a Google Fonts solo la versione dritta di Inter e
 * di Fraunces. Nel foglio di stile che ne usciva c'erano ventiquattro
 * dichiarazioni di carattere e tutte e ventiquattro dicevano «dritto»: zero
 * inclinate.
 *
 * Intanto nel sito diciassette punti chiedono il corsivo. Il browser, non
 * trovandolo, se lo inventa: prende le lettere dritte e le storce di qualche
 * grado. Si chiama corsivo sintetico e si vede — le curve si deformano e le
 * lettere si attaccano. Il punto peggiore è il titolone della home, dove la
 * parola «veri» sta in Fraunces a sessanta pixel: Fraunces un corsivo vero,
 * disegnato a mano, ce l'ha, e non arrivava mai.
 *
 * L'INVARIANTE. Finché nel sito c'è anche un solo punto che chiede il corsivo,
 * ogni carattere caricato dal layout deve dichiarare la variante inclinata.
 * Se qualcuno la toglie di nuovo, questa prova diventa rossa.
 *
 * (I componenti React qui non si montano — vitest non compila il JSX — quindi
 * l'invariante si controlla sul sorgente, come nelle altre prove di struttura
 * del repo. Il foglio di stile che ne esce non si può guardare da qui: per
 * generarlo serve la rete verso Google Fonts, e una prova unitaria non va in
 * rete. È stato controllato a mano il 3/9 eseguendo il vero caricatore di
 * next/font con queste stesse opzioni: da zero dichiarazioni inclinate si passa
 * a sette per Inter e quindici per Fraunces.)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

const LAYOUT = readFileSync('app/layout.tsx', 'utf8');

/** Ritaglia il testo fra parentesi graffe bilanciate a partire da `da`. */
function bloccoGraffe(src: string, da: number): string {
  let livello = 0;
  for (let i = da; i < src.length; i++) {
    if (src[i] === '{') livello++;
    else if (src[i] === '}') {
      livello--;
      if (livello === 0) return src.slice(da, i + 1);
    }
  }
  return '';
}

/** I caratteri che il layout carica dal disco (R05-019), con le opzioni che passa a ognuno. */
function caratteriCaricati(): Array<{ nome: string; opzioni: string }> {
  const nomi: Array<{ nome: string; opzioni: string }> = [];
  const chiamate = LAYOUT.matchAll(/const\s+(\w+)\s*=\s*localFont\s*\(\s*\{/g);
  for (const m of chiamate) {
    const inizio = LAYOUT.indexOf('{', m.index! + m[0].length - 1);
    nomi.push({ nome: m[1], opzioni: bloccoGraffe(LAYOUT, inizio) });
  }
  return nomi;
}

/** Ogni punto del sito che chiede al browser di inclinare il testo. */
function puntiCheChiedonoIlCorsivo(): string[] {
  const trovati: string[] = [];
  for (const radice of ['app', 'components']) {
    for (const f of readdirSync(radice, { recursive: true }) as string[]) {
      if (!f.endsWith('.tsx')) continue;
      const percorso = path.join(radice, f);
      const src = readFileSync(percorso, 'utf8');
      // La classe `italic` di Tailwind e il tag <em>, che il browser inclina.
      if (/className="[^"]*\bitalic\b/.test(src) || /<em[\s>]/.test(src)) trovati.push(percorso);
    }
  }
  return trovati;
}

/** I tag delle tabelle che il formato WOFF2 sa indicare con un numero solo (flags & 63). */
const TAG_NOTI = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

/**
 * Legge da un file WOFF2 le tre tabelle che dicono se il disegno è inclinato:
 * `head` (macStyle), `OS/2` (fsSelection) e `post` (italicAngle). Nessuna libreria:
 * solo `node:zlib`. head, OS/2 e post non sono mai trasformate, quindi dopo la
 * decompressione Brotli si leggono così come sono.
 */
function leggiIlCorsivoDalWoff2(percorso: string) {
  const file = readFileSync(percorso);
  expect(file.toString('latin1', 0, 4), `${percorso} non è un WOFF2`).toBe('wOF2');
  const numTabelle = file.readUInt16BE(12);
  const compressi = file.readUInt32BE(20);

  let pos = 48;
  const base128 = () => {
    let valore = 0;
    for (let i = 0; i < 5; i++) {
      const b = file[pos++];
      valore = valore * 128 + (b & 0x7f);
      if (!(b & 0x80)) return valore;
    }
    throw new Error('UIntBase128 non valido');
  };

  const tabelle: Array<{ tag: string; lunghezza: number }> = [];
  for (let i = 0; i < numTabelle; i++) {
    const flags = file[pos++];
    let tag: string;
    if ((flags & 63) === 63) {
      tag = file.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = TAG_NOTI[flags & 63];
    }
    const versione = flags >> 6;
    const lunghezzaOriginale = base128();
    // glyf e loca sono trasformate con versione 0; tutte le altre con versione diversa da 0.
    const trasformata = tag === 'glyf' || tag === 'loca' ? versione === 0 : versione !== 0;
    tabelle.push({ tag, lunghezza: trasformata ? base128() : lunghezzaOriginale });
  }

  const dati = brotliDecompressSync(file.subarray(pos, pos + compressi));
  const inizi = new Map<string, number>();
  let cursore = 0;
  for (const t of tabelle) {
    inizi.set(t.tag, cursore);
    cursore += t.lunghezza;
  }
  const tab = (tag: string) => {
    const inizio = inizi.get(tag);
    if (inizio === undefined) throw new Error(`${percorso}: manca la tabella ${tag}`);
    return inizio;
  };

  const head = tab('head');
  // Se i conti dei byte non tornano, qui lo si vede subito.
  expect(dati.readUInt32BE(head + 12), `${percorso}: tabella head non trovata dove dovrebbe`).toBe(0x5f0f3cf5);
  return {
    macStyleCorsivo: (dati.readUInt16BE(head + 44) & 0b10) !== 0,
    fsSelectionCorsivo: (dati.readUInt16BE(tab('OS/2') + 62) & 0b1) !== 0,
    angoloCorsivo: dati.readInt32BE(tab('post') + 4) / 65536,
  };
}

const CARATTERI = caratteriCaricati();

describe('il corsivo del sito', () => {
  it('nel sito ci sono davvero dei punti che chiedono il corsivo', () => {
    const punti = puntiCheChiedonoIlCorsivo();
    // Se un giorno il corsivo sparisse dal sito, questa prova andrebbe ripensata
    // invece che aggirata: è lei a dire perché le regole qui sotto servono.
    expect(punti.length, 'nessun punto chiede più il corsivo').toBeGreaterThan(0);
    expect(punti).toContain('app/page.tsx'); // il titolone della home
  });

  it('il layout carica i caratteri dal disco, e sono più di uno', () => {
    expect(CARATTERI.map((c) => c.nome)).toEqual(expect.arrayContaining(['inter', 'fraunces']));
    for (const c of CARATTERI) {
      expect(c.opzioni, `non trovo come viene chiamato ${c.nome}`).not.toBe('');
    }
  });

  for (const carattere of CARATTERI) {
    it(`${carattere.nome} dichiara anche la variante inclinata, non solo quella dritta`, () => {
      const stili = [...carattere.opzioni.matchAll(/style\s*:\s*'(\w+)'/g)].map((m) => m[1]);
      expect(stili, `${carattere.nome} non dichiara il corsivo: il browser lo inventa`).toContain('italic');
      expect(stili, `${carattere.nome} non dichiara più il dritto`).toContain('normal');
    });

    it(`${carattere.nome} i file del corsivo e del dritto esistono davvero sul disco`, () => {
      const percorsi = [...carattere.opzioni.matchAll(/path\s*:\s*'([^']+)'/g)].map((m) => m[1]);
      expect(percorsi.length).toBeGreaterThanOrEqual(2);
      for (const rel of percorsi) {
        expect(existsSync(path.join('app', rel)), `${rel} manca`).toBe(true);
      }
    });

    it(`${carattere.nome} il corsivo ce l'ha davvero: non stiamo chiedendo una variante inesistente`, () => {
      // Ogni file è dichiarato con il suo `style`: leggiamo dentro il woff2 che
      // quello dichiarato `italic` sia un disegno inclinato vero e non una copia
      // del dritto, e che quello dichiarato `normal` non lo sia.
      const voci = [...carattere.opzioni.matchAll(/path\s*:\s*'([^']+)'[^}]*?style\s*:\s*'(\w+)'/g)].map((m) => ({
        percorso: path.join('app', m[1]),
        stile: m[2],
      }));
      const corsivo = voci.find((v) => v.stile === 'italic');
      const dritto = voci.find((v) => v.stile === 'normal');
      expect(corsivo, `${carattere.nome} non dichiara un file italic`).toBeTruthy();
      expect(dritto, `${carattere.nome} non dichiara un file normal`).toBeTruthy();

      const c = leggiIlCorsivoDalWoff2(corsivo!.percorso);
      expect(c.macStyleCorsivo || c.fsSelectionCorsivo, `${corsivo!.percorso} non ha il bit del corsivo`).toBe(true);
      expect(c.angoloCorsivo, `${corsivo!.percorso} ha l'angolo dritto: è una copia del dritto`).toBeLessThan(0);

      const d = leggiIlCorsivoDalWoff2(dritto!.percorso);
      expect(d.macStyleCorsivo, `${dritto!.percorso} è dichiarato dritto ma ha macStyle corsivo`).toBe(false);
      expect(d.fsSelectionCorsivo, `${dritto!.percorso} è dichiarato dritto ma ha fsSelection corsivo`).toBe(false);
      expect(d.angoloCorsivo, `${dritto!.percorso} è dichiarato dritto ma è inclinato`).toBe(0);
    });
  }

  it('il dritto resta precaricato: il corsivo non deve rubargli il posto', () => {
    // `preload` vale per tutto il carattere, non per la singola variante: se
    // qualcuno lo spegne per alleggerire il corsivo, spegne anche il dritto —
    // e il dritto è quello del titolone, cioè l'elemento più grande della home.
    for (const c of CARATTERI) {
      expect(c.opzioni, `${c.nome} ha il precaricamento spento`).not.toMatch(
        /preload\s*:\s*false/,
      );
    }
  });
});
