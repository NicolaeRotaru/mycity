import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — LA MISURA DI PARTENZA DI UN TITOLO ERA PIÙ GRANDE DI QUASI TUTTE QUELLE SCELTE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * In `app/globals.css` ci sono tre regole di elemento — `h1`, `h2`, `h3` — che danno una misura al
 * titolo che non ne dichiara una sua. h2 diceva 30 pixel. Risultato, verificato uno per uno:
 *
 *  · la parola «Filtri», in cima alla colonna dei filtri della ricerca e delle categorie, usciva a
 *    30px con accanto il suo contatore da 10px;
 *  · «Promozioni attive», nella vetrina di un negozio, usciva a 30px mentre tutte le altre
 *    intestazioni della stessa vetrina passano da `SectionHeading` e stanno a 20/24px: due titoli
 *    di pari grado, due misure diverse nella stessa pagina.
 *
 * ── Perché la cura sta nel foglio di stile e non in ogni pagina ─────────────────────────────────
 * I titoli senza misura sono decine. Aggiungere una classe a ognuno cura oggi e non domani: il
 * titolo che qualcuno scriverà la settimana prossima nascerà di nuovo a 30px. La regola si
 * restringe una volta sola, e vale anche per lui.
 *
 * ── Il numero non è a gusto: è la mediana di quelli scelti a mano ───────────────────────────────
 * La misura di partenza è quella che si prende quando NESSUNO ha deciso. Se è più grande della
 * mediana delle misure decise, allora non decidere fa un titolo più grosso della maggioranza di
 * quelli decisi — che è esattamente il difetto, detto in numeri.
 *
 * Questa prova rifà il conto sui file veri a ogni giro: raccoglie ogni `<h2>` e `<h3>` che dichiara
 * la propria misura, ne prende la mediana, e pretende che la misura di partenza non la superi. Non
 * cerca nessuna parola: se domani il progetto si riempie di titoli davvero grandi, la mediana sale
 * e la soglia si alza da sola.
 *
 * ⚠️ Cosa NON prova: che a schermo sia bello, e non guarda `h1` (48px di partenza contro una
 * mediana di 30px su 65 titoli scelti). L'h1 è un difetto a parte, segnalato e non toccato qui:
 * i titoloni delle pagine di presentazione vanno guardati con l'occhio prima che col conto.
 */

const RADICE = process.cwd();
const GLOBALS = readFileSync('app/globals.css', 'utf8');

/** I titoli che questa prova sorveglia, e da dove parte la loro misura in globals.css. */
const SORVEGLIATI = ['h2', 'h3'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// La scala delle misure, letta dal foglio di stile vero.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Da `--text-xl: 1.25rem` a 20 pixel. I nomi sono gli stessi della scala di Tailwind (`text-xl`) e
 * i valori combaciano uno per uno: il foglio di stile dice di essere lo specchio del design system.
 * Se un giorno divergessero, questa tabella seguirebbe il foglio — che è la casa giusta.
 */
function scalaDelleMisure(): Record<string, number> {
  const scala: Record<string, number> = {};
  for (const m of GLOBALS.matchAll(/--text-([\w]+):\s*([\d.]+)rem/g)) {
    scala[m[1]] = Number(m[2]) * 16;
  }
  // `2xs` non sta fra i token con quel nome ma nella configurazione di Tailwind.
  const tw = readFileSync('tailwind.config.ts', 'utf8').match(/'2xs':\s*'([\d.]+)rem'/);
  if (tw) scala['2xs'] = Number(tw[1]) * 16;
  return scala;
}

const SCALA = scalaDelleMisure();

/** La misura di partenza che globals.css dà a un titolo, in pixel. */
function misuraDiPartenza(tag: string): number {
  const riga = GLOBALS.match(new RegExp(`^${tag}\\s*\\{[^}]*font-size:\\s*var\\(--text-([\\w]+)\\)`, 'm'));
  expect(riga, `in globals.css non c'è più la misura di partenza di <${tag}>: la prova va riscritta`).toBeTruthy();
  const px = SCALA[riga![1]];
  expect(px, `il token --text-${riga![1]} non esiste nella scala`).toBeGreaterThan(0);
  return px;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le misure scelte a mano, raccolte dai file veri.
// ─────────────────────────────────────────────────────────────────────────────

function fileJsx(cartella: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(cartella)) {
    if (voce === 'node_modules' || voce === '.next' || voce === '.git') continue;
    const p = join(cartella, voce);
    if (statSync(p).isDirectory()) fileJsx(p, dentro);
    else if (p.endsWith('.tsx')) dentro.push(p);
  }
  return dentro;
}

const TUTTI = [...fileJsx(join(RADICE, 'app')), ...fileJsx(join(RADICE, 'components'))];

/**
 * Le misure che un titolo si sceglie da solo, una per elemento.
 *
 * Di un titolo scritto `text-xl sm:text-2xl` conta la più grande: è quella che vince appena lo
 * schermo cresce, e questo conto deve stare dalla parte severa.
 */
function misureScelte(tag: string): number[] {
  const scelte: number[] = [];
  const nomi = Object.keys(SCALA).sort((a, b) => b.length - a.length).join('|');
  for (const file of TUTTI) {
    const src = readFileSync(file, 'utf8');
    const titoli = src.matchAll(new RegExp(`<${tag}\\b[^>]*?className="([^"]*)"`, 'g'));
    for (const t of titoli) {
      const misure = [...t[1].matchAll(new RegExp(`(?:^|\\s)(?:[a-z0-9-]+:)?text-(${nomi})(?![\\w-])`, 'g'))]
        .map((m) => SCALA[m[1]]);
      if (misure.length > 0) scelte.push(Math.max(...misure));
    }
  }
  return scelte.sort((a, b) => a - b);
}

function mediana(numeri: number[]): number {
  return numeri[Math.floor(numeri.length / 2)];
}

describe('il metro si legge davvero dai file (se no non sta misurando niente)', () => {
  it('la scala delle misure viene dal foglio di stile', () => {
    expect(SCALA['xl'], '--text-xl non si legge più in globals.css').toBe(20);
    expect(SCALA['3xl'], '--text-3xl non si legge più in globals.css').toBe(30);
  });

  it('nel progetto ci sono abbastanza titoli con la misura scelta a mano', () => {
    for (const tag of SORVEGLIATI) {
      expect(
        misureScelte(tag).length,
        `di <${tag}> non trovo più nessuna misura scelta a mano: il conto qui sotto sarebbe vuoto`,
      ).toBeGreaterThan(10);
    }
  });
});

describe('un titolo che nessuno ha misurato non esce più grande di quelli misurati', () => {
  for (const tag of SORVEGLIATI) {
    it(`<${tag}> parte da una misura che non supera la mediana di quelle scelte`, () => {
      const scelte = misureScelte(tag);
      const meta = mediana(scelte);
      const partenza = misuraDiPartenza(tag);

      const sopra = scelte.filter((m) => m < partenza).length;
      expect(
        partenza,
        `<${tag}> senza classe esce a ${partenza}px, mentre la mediana delle ${scelte.length} misure ` +
          `scelte a mano è ${meta}px (${sopra} su ${scelte.length} stanno sotto i ${partenza}px). ` +
          'Non decidere fa un titolo più grosso della maggioranza di quelli decisi: è il difetto, in numeri.',
      ).toBeLessThanOrEqual(meta);
    });
  }

  it('e i titoli restano in ordine: <h2> non è più piccolo di <h3>', () => {
    expect(
      misuraDiPartenza('h2'),
      'abbassando le misure di partenza si è persa la gerarchia: un h3 grosso come un h2 non dice più niente',
    ).toBeGreaterThanOrEqual(misuraDiPartenza('h3'));
  });
});
