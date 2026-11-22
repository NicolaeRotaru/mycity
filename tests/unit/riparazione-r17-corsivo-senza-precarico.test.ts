/**
 * 22/11/2026 — IL CORSIVO NON SI PRECARICA SU OGNI PAGINA, MA RESTA UN CORSIVO VERO.
 *
 * Ogni pagina ordinava al browser di scaricare SUBITO anche i file del corsivo (Inter e Fraunces),
 * che su prodotto, carrello e cassa non disegnano niente: in gara con la foto del prodotto. Il
 * precaricamento di next/font vale per tutta un'istanza di `localFont`, quindi il corsivo sta in
 * un'istanza a parte, senza precaricamento, con lo stesso nome di famiglia del dritto: per il
 * browser è una famiglia sola, e il file inclinato lo scarica solo dove c'è del testo in corsivo.
 *
 * La prova non legge il layout con una espressione regolare: lo passa allo stesso trasformatore di
 * Next (SWC, quello che trasforma le chiamate a `localFont`) e alle stesse funzioni che fanno le
 * regole @font-face (il caricatore di next/font/local e il suo passo postcss). Guarda cosa ne esce:
 * per ogni file, se è precaricato (Next lo segna con `.p` nel nome) e in quale famiglia finisce.
 */
import { describe, it, expect } from 'vitest';
import { readFile, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
const RADICE = process.cwd();
const { transform } = require('next/dist/build/swc') as {
  transform: (codice: string, opzioni: Record<string, unknown>) => Promise<{ code: string }>;
};
type Caricatore = (a: Record<string, unknown>) => Promise<{
  css: string; fallbackFonts?: string[]; weight?: string; style?: string; variable?: string; adjustFontFallback?: unknown;
}>;
const caricatore = require('next/dist/compiled/@next/font/dist/local/loader.js').default as Caricatore;
const pluginDeiCaratteri = require('next/dist/build/webpack/loaders/next-font-loader/postcss-next-font.js')
  .default as (o: Record<string, unknown>) => postcss.Plugin;

type Faccia = { famiglia: string; stile: string; precaricata: boolean; file: string };
type Istanza = { nome: string; variabile: string | undefined; facce: Faccia[] };

/** Le istanze di `localFont` del layout, trasformate e caricate come le carica Next. */
async function caratteriDelLayout(): Promise<Istanza[]> {
  const { code } = await transform(readFileSync(path.join(RADICE, 'app/layout.tsx'), 'utf8'), {
    filename: path.join(RADICE, 'app/layout.tsx'),
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' },
    fontLoaders: { fontLoaders: ['next/font/local', 'next/font/google'], relativeFilePathFromRoot: 'app/layout.tsx' },
  });
  const richieste = [...code.matchAll(/from 'next\/font\/local\/target\.css\?(\{.*\})';/g)].map(
    (m) => JSON.parse(m[1]) as { import: string; arguments: Record<string, unknown>[]; variableName: string },
  );
  const istanze: Istanza[] = [];
  for (const r of richieste) {
    const emessi: Array<{ url: string; precaricato: boolean }> = [];
    const caricato = await caricatore({
      functionName: r.import,
      variableName: r.variableName,
      data: r.arguments,
      emitFontFile: (_contenuto: Buffer, est: string, precarica: boolean) => {
        // Il nome che dà Next: `[hash].p.[est]` per i file da precaricare.
        const url = `/media/f${emessi.length}${precarica ? '.p' : ''}.${est}`;
        emessi.push({ url, precaricato: precarica });
        return url;
      },
      resolve: async (p: string) => path.join(RADICE, 'app', p),
      loaderContext: { fs: { readFile } },
    });
    const finale = await postcss([
      pluginDeiCaratteri({
        exports: [],
        fallbackFonts: caricato.fallbackFonts,
        adjustFontFallback: caricato.adjustFontFallback,
        variable: caricato.variable,
        weight: caricato.weight,
        style: caricato.style,
      }),
    ]).process(caricato.css, { from: undefined });
    const facce: Faccia[] = [];
    finale.root.walkAtRules('font-face', (regola) => {
      const valore = (p: string) => regola.nodes?.find((n) => n.type === 'decl' && n.prop === p) as postcss.Declaration | undefined;
      const src = valore('src')?.value ?? '';
      const url = src.match(/url\(([^)]+)\)/)?.[1];
      if (!url || !url.startsWith('/media/')) return; // il carattere di riserva (local("Arial")): non è un file
      facce.push({
        famiglia: (valore('font-family')?.value ?? '').replace(/['"]/g, '').toLowerCase(),
        stile: valore('font-style')?.value ?? 'normal',
        precaricata: emessi.find((e) => e.url === url)!.precaricato,
        file: url,
      });
    });
    istanze.push({ nome: r.variableName, variabile: caricato.variable, facce });
  }
  return istanze;
}

const ISTANZE = await caratteriDelLayout();
const FACCE = ISTANZE.flatMap((i) => i.facce);

/** La famiglia che il sito usa davvero: quella scritta nella variabile CSS (--font-inter, --font-serif). */
function famigliaDellaVariabile(variabile: string): string {
  const istanza = ISTANZE.find((i) => i.variabile === variabile);
  expect(istanza, `nessun carattere del layout imposta ${variabile}`).toBeTruthy();
  const dritte = istanza!.facce.filter((f) => f.stile === 'normal');
  expect(dritte.length, `${variabile} non ha un dritto`).toBeGreaterThan(0);
  return dritte[0]!.famiglia;
}

describe('i caratteri del layout, come li carica Next', () => {
  it('la prova vede davvero le facce: dritto e corsivo, per Inter e per Fraunces', () => {
    expect(FACCE.length, 'il layout non carica più nessun file di caratteri').toBeGreaterThanOrEqual(12);
    expect(FACCE.some((f) => f.stile === 'italic')).toBe(true);
    expect(FACCE.some((f) => f.stile === 'normal')).toBe(true);
  });

  it('nessun file del corsivo è precaricato', () => {
    const corsiviPrecaricati = FACCE.filter((f) => f.stile === 'italic' && f.precaricata);
    expect(
      corsiviPrecaricati.map((f) => `${f.famiglia} ${f.file}`),
      'il corsivo torna a essere scaricato subito su ogni pagina, anche dove non c’è testo in corsivo',
    ).toEqual([]);
  });

  it('il dritto resta precaricato', () => {
    const dritti = FACCE.filter((f) => f.stile === 'normal');
    expect(dritti.filter((f) => !f.precaricata).map((f) => `${f.famiglia} ${f.file}`), 'un dritto ha perso il precaricamento').toEqual([]);
  });

  for (const variabile of ['--font-inter', '--font-serif']) {
    it(`${variabile}: il corsivo sta nella stessa famiglia del dritto (corsivo vero, non inclinato dal browser)`, () => {
      const famiglia = famigliaDellaVariabile(variabile);
      const corsivi = FACCE.filter((f) => f.stile === 'italic' && f.famiglia === famiglia);
      expect(
        corsivi.length,
        `nella famiglia «${famiglia}» non c’è nessun file inclinato: il browser inventerebbe il corsivo`,
      ).toBeGreaterThan(0);
    });
  }
});
