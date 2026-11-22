/**
 * Una foto non si rimpicciolisce due volte: un <Image> di next/image con un indirizzo remoto
 * deve avere un `loader` (la misura la fa solo il CDN di Supabase) oppure `unoptimized`; senza
 * nessuno dei due Next manda la foto anche a /_next/image (Vercel), che la ridimensiona una seconda volta.
 * La prova legge l'albero dei sorgenti e controlla che ogni punto ne abbia uno, e che i dieci punti
 * della voce ne abbiano uno e non passino l'indirizzo già trasformato.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RADICE = process.cwd();

function tsx(dir: string, fuori: string[] = []): string[] {
  for (const e of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) tsx(rel, fuori);
    else if (e.name.endsWith('.tsx')) fuori.push(rel);
  }
  return fuori;
}

/** Ogni tag <Image …> / <FotoConRipiego …> con le sue righe di attributi. */
function tag(file: string): { riga: number; testo: string }[] {
  const s = readFileSync(join(RADICE, file), 'utf8');
  const trovati: { riga: number; testo: string }[] = [];
  const re = /<(?:Image|FotoConRipiego)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let i = m.index + 6;
    let graffe = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '{') graffe++;
      else if (c === '}') graffe--;
      else if (c === '>' && graffe === 0) break;
    }
    trovati.push({ riga: s.slice(0, m.index).split('\n').length, testo: s.slice(m.index, i + 1) });
  }
  return trovati;
}

const FILE = [...tsx('app'), ...tsx('components')].filter(
  (f) => f !== 'components/ui/FotoConRipiego.tsx' && /next\/image|FotoConRipiego/.test(readFileSync(join(RADICE, f), 'utf8')),
);

const DIECI = [
  'app/product/[id]/page.tsx',
  'components/store-sections/ReviewsSection.tsx',
  'components/home/StoriesCarousel.tsx',
  'components/StoryViewer.tsx',
  'components/home/ShopOfMonthHero.tsx',
  'components/MobileAccountSheet.tsx',
  'app/shop-of-month/page.tsx',
  'app/lists/[id]/page.tsx',
  'app/seller/stories/page.tsx',
];

describe('nessuna foto remota ottimizzata due volte', () => {
  it('ogni <Image> ha un loader o unoptimized', () => {
    const senza: string[] = [];
    for (const f of FILE) for (const t of tag(f)) if (!/\bloader=/.test(t.testo) && !/\bunoptimized\b/.test(t.testo)) senza.push(`${f}:${t.riga}`);
    expect(senza, 'queste <Image> passano anche da /_next/image').toEqual([]);
  });

  it('nei punti della voce la src non è già trasformata da sizedImage/logoNegozio con un loader che la rifà', () => {
    // Dove il loader c'è, la misura la sceglie lui: la src deve essere l'indirizzo originale.
    const doppi: string[] = [];
    for (const f of ['app/lists/[id]/page.tsx', 'app/seller/stories/page.tsx', 'app/shop-of-month/page.tsx', 'components/MobileAccountSheet.tsx']) {
      for (const t of tag(f)) if (/src=\{(sizedImage|logoNegozio)\(/.test(t.testo)) doppi.push(`${f}:${t.riga}`);
    }
    expect(doppi).toEqual([]);
  });

  it('i punti della voce esistono ancora (la prova non tace per un file spostato)', () => {
    for (const f of DIECI) expect(tag(f).length, f).toBeGreaterThan(0);
  });
});
