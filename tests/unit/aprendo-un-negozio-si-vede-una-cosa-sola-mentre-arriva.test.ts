/**
 * 3/9/2026 — APRENDO UN NEGOZIO SI VEDEVANO TRE PAGINE DIVERSE IN FILA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * ① Il guscio del server disegnava uno scheletro: una banda alta 192 punti e
 *    otto quadrati in griglia.
 * ② Appena partiva il codice del browser quello scheletro spariva, e la pagina
 *    diventava alta poche righe con un cerchietto che gira in mezzo.
 * ③ Poi arrivava il negozio vero, con la copertina alta 240 punti.
 *
 * Tre impaginazioni di seguito sono peggio di una lenta: dicono a chi guarda che
 * il sito non sa cosa sta facendo. È il motivo per cui un cliente pensa che sia
 * rotto e se ne va prima di aver visto un prodotto.
 *
 * La causa non era la lentezza: erano tre elenchi di classi scritti a mano in
 * tre file che nessuno teneva allineati.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Che l'attesa sia UNA, disegnata da un pezzo solo, e che le misure che devono
 * combaciare — l'altezza della copertina, il contenitore della pagina — vengano
 * da un posto solo, così non possono più divergere. Se domani qualcuno rimette
 * un cerchietto o riscrive a mano l'altezza, qui diventa rosso.
 *
 * Non ho potuto aprire un browser: che a schermo non ci sia più nessun salto lo
 * deduco dalle misure, non l'ho visto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALTEZZA_COPERTINA, CONTENITORE_PAGINA_NEGOZIO } from '@/components/store-sections/misure-vetrina';

const RADICE = process.cwd();
const ROTTA_NEGOZIO = join(RADICE, 'app/store');
const SCHELETRO = readFileSync(join(RADICE, 'components/store-sections/ScheletroNegozio.tsx'), 'utf8');
const HERO = readFileSync(join(RADICE, 'components/store-sections/HeroSection.tsx'), 'utf8');

/** Tutti i file della rotta del negozio: la pagina, il guscio, l'attesa, le pagine su misura. */
function fileDellaRotta(dir = ROTTA_NEGOZIO, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) fileDellaRotta(percorso, dentro);
    else if (/\.tsx$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

const ROTTA = fileDellaRotta().map((f) => ({
  nome: relative(RADICE, f).replace(/\\/g, '/'),
  src: readFileSync(f, 'utf8'),
}));

describe('la scansione guarda davvero i file giusti', () => {
  it('la rotta del negozio ha la pagina, il guscio e il file dell’attesa', () => {
    const nomi = ROTTA.map((f) => f.nome);
    expect(nomi).toContain('app/store/[id]/page.tsx');
    expect(nomi).toContain('app/store/[id]/layout.tsx');
    expect(nomi).toContain('app/store/[id]/loading.tsx');
    expect(nomi.length, 'la scansione della rotta non trova quasi niente').toBeGreaterThanOrEqual(4);
  });

  it('le misure condivise esistono e sono classi vere', () => {
    expect(ALTEZZA_COPERTINA, "l'altezza della copertina è vuota: ogni confronto passerebbe").toMatch(/^h-\S+$/);
    expect(CONTENITORE_PAGINA_NEGOZIO).toMatch(/\bmax-w-\S+\b/);
  });
});

describe('mentre il negozio arriva si vede una cosa sola', () => {
  it('nessuna pagina del negozio mette più un cerchietto che gira', () => {
    // Era la seconda delle tre impaginazioni: la pagina si accorciava da schermo
    // pieno a poche righe, e poi si riapriva.
    const colpevoli = ROTTA.filter((f) => /\bLoadingState\b/.test(f.src)).map((f) => f.nome);
    expect(
      colpevoli,
      'una pagina del negozio aspetta con un cerchietto invece che con lo scheletro: ' +
        'a schermo è un terzo salto, e chi guarda pensa che il sito sia rotto',
    ).toEqual([]);
  });

  it('chi aspetta, aspetta con lo stesso scheletro', () => {
    const cheAspettano = ROTTA.filter((f) => /isLoading|export default function \w*Loading/.test(f.src));
    expect(cheAspettano.length, 'nessun file della rotta aspetta niente: la prova non misura').toBeGreaterThanOrEqual(2);

    for (const f of cheAspettano) {
      expect(f.src, `${f.nome} disegna un'attesa sua invece di usare quella condivisa`).toMatch(
        /<ScheletroNegozio\s*\/>/,
      );
    }
  });

  it('il sipario copre anche il guscio, non solo la pagina', () => {
    // Da quando il guscio legge il negozio sul server, è LUI a fermarsi per
    // primo. Un'attesa scritta dentro il guscio non può fargli da sipario: la
    // trova solo chi è già entrato. Senza una schermata di attesa sopra, chi
    // apre un negozio vede il sipario generale del sito — che ha la forma di
    // una pagina qualsiasi — e poi il negozio: il salto torna, spostato in su.
    const guscio = ROTTA.find((f) => f.nome === 'app/store/[id]/layout.tsx')!.src;
    const gusciofermo = /export default async function/.test(guscio) && /await\s+precarica/.test(guscio);
    if (!gusciofermo) return; // il guscio non aspetta niente: nessun sipario da pretendere

    const sopra = ROTTA.find((f) => f.nome === 'app/store/loading.tsx');
    expect(
      sopra?.src,
      'il guscio del negozio si ferma a leggere sul server, ma sopra di lui non c’è nessuna ' +
        'schermata di attesa col volto del negozio: serve app/store/loading.tsx',
    ).toMatch(/<ScheletroNegozio\s*\/>/);
  });

  it('lo scheletro non è un cerchietto travestito', () => {
    expect(SCHELETRO).not.toMatch(/animate-spin/);
    // Ha la forma di quello che arriva: la cornice della copertina e la griglia
    // dei prodotti, quella vera, non una scritta a mano.
    expect(SCHELETRO).toContain('SkeletonGrid');
    expect(SCHELETRO, 'lo scheletro si scrive le colonne da solo: tornerà a divergere').not.toMatch(/grid-cols-\d/);
  });
});

describe('e ha la forma di quello che sta arrivando', () => {
  it('la copertina dell’attesa è alta quanto quella vera', () => {
    // Erano 192 punti contro 240: la pagina si riorganizzava tutta all'arrivo.
    expect(SCHELETRO, "lo scheletro non usa l'altezza condivisa").toContain('ALTEZZA_COPERTINA');

    // Le righine e le pastiglie del segnaposto hanno la loro altezza (h-3, h-4,
    // h-7) ed è giusto così. Quello che non deve tornare è una BANDA scritta a
    // mano: era `h-48` contro una copertina da `h-60`, ed è il salto che si
    // vedeva. Nessuna altezza grande scritta a mano, quindi.
    const grandi = [...SCHELETRO.matchAll(/\bh-(\d+)\b/g)].map((m) => Number(m[1])).filter((n) => n >= 12);
    expect(
      grandi,
      "lo scheletro si è riscritto un'altezza grande a mano: è così che era nato il salto fra 192 e 240 punti",
    ).toEqual([]);

    const copertinaVera = HERO.split('\n').find((r) => /relative .*overflow-hidden/.test(r));
    expect(copertinaVera, 'non trovo più la copertina nella hero: la prova va riscritta').toBeTruthy();
    expect(copertinaVera!, 'la copertina vera si è riscritta un’altezza sua').toContain('ALTEZZA_COPERTINA');
  });

  it('e il contenitore è lo stesso prima e dopo', () => {
    expect(SCHELETRO).toContain('CONTENITORE_PAGINA_NEGOZIO');

    const pagine = ROTTA.filter((f) => f.nome.endsWith('page.tsx'));
    expect(pagine.length).toBeGreaterThanOrEqual(2);
    for (const p of pagine) {
      expect(p.src, `${p.nome} non usa il contenitore condiviso`).toContain('CONTENITORE_PAGINA_NEGOZIO');
      expect(
        p.src,
        `${p.nome} si riscrive a mano la larghezza della pagina: è così che le tre impaginazioni si erano allontanate`,
      ).not.toMatch(/container mx-auto px-4 py-6 max-w-5xl/);
    }
  });
});
